'use strict';

/**
 * Scheduled sync: approved sponsorship applications -> Clients in the
 * Client Deliverables Hub.
 *
 * Airtable cannot link or write across bases on its own, so this runs on a
 * schedule instead. It finds applications marked Approved that have not been
 * pushed yet, creates the matching Client in the Hub, and stamps the
 * application so it is never pushed twice.
 *
 * The Client is created as Onboarding / Awaiting payment. Recording the
 * payment in Airtable is what triggers deliverable generation.
 *
 * Approval alone is not enough to cross this line: the application's business
 * verification must have passed as well. An approved but unverified applicant
 * is held back and named in the logs until its checks are finished.
 *
 * Each approved applicant is also written into the Businesses table of the
 * Sales Funnel base as Closed Won, which is what actually holds their school
 * slot and blocks their category for the next applicant in the same trade.
 *
 * Required environment variables:
 *   AIRTABLE_TOKEN   must have data.records:read + write on ALL THREE bases:
 *                    the Lead Follow-Up Funnel, the Client Deliverables Hub,
 *                    and the Business Sales Funnel Manager
 * Optional (default to the current IDs):
 *   AIRTABLE_BASE_ID, AIRTABLE_APPLICATION_TABLE_ID,
 *   AIRTABLE_HUB_BASE_ID, AIRTABLE_HUB_CLIENTS_TABLE_ID,
 *   AIRTABLE_HUB_PACKAGES_TABLE_ID
 */

function env(name) {
  var value = process.env[name];
  if (value === undefined) {
    var match = Object.keys(process.env).find(function (key) {
      return key.toLowerCase() === name.toLowerCase();
    });
    if (match) value = process.env[match];
  }
  return typeof value === 'string' ? value.trim() : value;
}

var LEAD_BASE   = env('AIRTABLE_BASE_ID') || 'appiaYFwD340oK6uQ';
var APPS_TABLE  = env('AIRTABLE_APPLICATION_TABLE_ID') || 'tbl79enOo6bpusR00';
var SALES_BASE  = env('AIRTABLE_SALES_BASE_ID') || 'app6eNzSFWvGNwt33';
var BUSINESSES_TBL = env('AIRTABLE_SALES_BUSINESSES_TABLE_ID') || 'tblGeTs8cOonu2J3F';
var SCHOOLS_TBL = env('AIRTABLE_SALES_SCHOOLS_TABLE_ID') || 'tblVcza0S27DK9pkQ';
var HUB_BASE    = env('AIRTABLE_HUB_BASE_ID') || 'appGG8camPZ04Tsz6';
var CLIENTS_TBL = env('AIRTABLE_HUB_CLIENTS_TABLE_ID') || 'tblQTVkBcVnolpo0P';
var PACKAGES_TBL= env('AIRTABLE_HUB_PACKAGES_TABLE_ID') || 'tblEiajhPxOQmlQ69';

var API = 'https://api.airtable.com/v0/';

function authHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function airtable(token, path, options) {
  var res = await fetch(API + path, Object.assign({ headers: authHeaders(token) }, options || {}));
  if (!res.ok) {
    var detail = await res.text();
    throw new Error('Airtable ' + res.status + ' on ' + path + ': ' + detail.slice(0, 300));
  }
  return res.json();
}

var REQUIRED_CHECKS = [
  'Check 1: Real and operating',
  'Check 2: Licensed or registered',
  'Check 3: Appropriate for a high school audience',
  'Check 4: Contact can commit the business',
  'Check 5: Reputation clear',
  'Check 6: School and category available'
];

/** Airtable returns a single select as a plain string or as {id, name}. */
function selectName(value) {
  return value && typeof value === 'object' ? value.name : value;
}

/**
 * An approved application may only become a Client once both gates have
 * actually cleared: the business is legitimate, and the school and category it
 * is being given are free.
 *
 * The status and every check are tested independently, so a status flipped to
 * Passed over an unfinished checklist is not enough. Confirmed Category and
 * Assigned Schools must be filled too, because check 6 means nothing without
 * them — it claims a specific trade is free at specific schools.
 *
 * This mirrors the Ready to Approve field, so the base and the code can never
 * disagree about whether an application is releasable.
 */
function isVerified(app) {
  var f = app.fields || {};

  if (selectName(f['Verification Status']) !== 'Passed') return false;
  if (!selectName(f['Confirmed Category'])) return false;

  var schools = f['Assigned Schools'];
  if (!Array.isArray(schools) || schools.length === 0) return false;

  return REQUIRED_CHECKS.every(function (check) {
    return f[check] === true;
  });
}

/** Applications that are approved and have not been pushed across yet. */
async function findApproved(token) {
  var formula = encodeURIComponent(
    "AND({Application Status}='Approved', NOT({Pushed to Deliverables Hub}))"
  );
  var data = await airtable(token, LEAD_BASE + '/' + APPS_TABLE + '?filterByFormula=' + formula + '&pageSize=50');
  return data.records || [];
}

/** Map the Hub's package names to their record IDs, so "Gold" resolves to a link. */
async function packageIdsByName(token) {
  var data = await airtable(token, HUB_BASE + '/' + PACKAGES_TBL + '?pageSize=100');
  var byName = {};
  (data.records || []).forEach(function (rec) {
    var name = rec.fields && rec.fields['Package Name'];
    if (name) byName[String(name).trim().toLowerCase()] = rec.id;
  });
  return byName;
}

/** Airtable formula strings are single-quoted, so a quote in a name must be escaped. */
function quote(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/** Map the Sales Funnel base's school names to their record IDs. */
async function schoolIdsByName(token) {
  var data = await airtable(token, SALES_BASE + '/' + SCHOOLS_TBL + '?pageSize=100');
  var byName = {};
  (data.records || []).forEach(function (rec) {
    var name = rec.fields && rec.fields['School Name'];
    if (name) byName[String(name).trim().toLowerCase()] = rec.id;
  });
  return byName;
}

/**
 * A sponsor who arrives through the application form is not in the Businesses
 * table, so nothing would hold their school slot or block their category and
 * the next applicant in the same trade would look clear when they are not.
 *
 * This writes them in as Closed Won. It matches on business name first,
 * because an inbound applicant is often already in the outbound pipeline as a
 * prospect — that record is advanced rather than duplicated.
 *
 * Idempotent by design: running it twice updates the same record. That is why
 * it runs before the Client is created, which is not idempotent.
 */
async function recordSchoolSlot(token, app, schoolsByName) {
  var f = app.fields || {};
  var name = String(f['Company Name'] || f['Applicant Name'] || '').trim();
  if (!name) throw new Error('application has no business name to register');

  var assigned = Array.isArray(f['Assigned Schools']) ? f['Assigned Schools'] : [];
  var schoolIds = assigned.map(function (schoolName) {
    var id = schoolsByName[String(schoolName).trim().toLowerCase()];
    // A school that cannot be resolved would silently leave its category
    // unblocked, so this fails rather than registering a partial slot.
    if (!id) throw new Error('no school named "' + schoolName + '" in the Sales Funnel base');
    return id;
  });

  var category = f['Confirmed Category'];
  var categoryName = category && typeof category === 'object' ? category.name : category;

  var fields = {
    'Business Name': name,
    'Funnel Stage': 'Closed Won',
    'Status': 'Active',
    'School(s)': schoolIds
  };
  if (categoryName) fields['Category'] = categoryName;
  if (f['Applicant Name']) fields['Contact Name'] = f['Applicant Name'];
  if (f['Email']) fields['Contact Email'] = f['Email'];
  if (f['Phone']) fields['Contact Phone'] = f['Phone'];

  var formula = encodeURIComponent("LOWER({Business Name})=" + quote(name.toLowerCase()));
  var found = await airtable(token,
    SALES_BASE + '/' + BUSINESSES_TBL + '?maxRecords=1&filterByFormula=' + formula);
  var existing = (found.records || [])[0];

  if (existing) {
    // Keep whatever the outbound team already wrote in Notes; just append.
    var note = 'Closed via the sponsorship application form on ' +
      new Date().toISOString().slice(0, 10) + ' (application ' + app.id + ').';
    var priorNotes = (existing.fields && existing.fields['Notes']) || '';
    fields['Notes'] = priorNotes ? priorNotes + '\n\n' + note : note;

    await airtable(token, SALES_BASE + '/' + BUSINESSES_TBL, {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id: existing.id, fields: fields }], typecast: true })
    });
    return { id: existing.id, matchedExistingProspect: true };
  }

  fields['Notes'] = 'Created automatically from the approved sponsorship application ' +
    app.id + '. Holds this sponsor\'s school slot and category exclusivity.';

  var created = await airtable(token, SALES_BASE + '/' + BUSINESSES_TBL, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: fields }], typecast: true })
  });
  return {
    id: created.records && created.records[0] && created.records[0].id,
    matchedExistingProspect: false
  };
}

function clientFieldsFrom(app, packagesByName) {
  var f = app.fields || {};
  var fields = {
    'Business Name': f['Company Name'] || f['Applicant Name'] || 'Unnamed sponsor',
    'Company Name': f['Company Name'] || '',
    'Contact Email': f['Email'] || '',
    'Client Status': 'Onboarding',
    'Payment Status': 'Awaiting payment'
  };

  if (f['Phone']) fields['Phone Number'] = f['Phone'];
  // Assigned Schools is what the reviewer confirmed is available; Preferred
  // School or Program is only what the applicant asked for.
  var assigned = Array.isArray(f['Assigned Schools']) ? f['Assigned Schools'].join(', ') : '';
  var schools = assigned || f['Preferred School or Program'];
  if (schools) fields['Sponsored School(s)'] = schools;

  var pkg = f['Selected Package'];
  var pkgName = pkg && typeof pkg === 'object' ? pkg.name : pkg;
  if (pkgName) {
    var id = packagesByName[String(pkgName).trim().toLowerCase()];
    if (id) fields['Selected Package'] = [id];
  }

  // Carry the context the team needs for the first call, in one readable block.
  var notes = [];
  notes.push('Created automatically from the approved sponsorship application.');
  if (f['Applicant Name']) notes.push('Contact: ' + f['Applicant Name'] + (f['Contact Role'] ? ' (' + f['Contact Role'] + ')' : ''));
  if (f['Business Category']) {
    var cat = f['Business Category'];
    notes.push('Category: ' + (typeof cat === 'object' ? cat.name : cat));
  }
  if (f['City']) notes.push('City: ' + f['City']);
  if (f['Website']) notes.push('Website: ' + f['Website']);
  if (f['Preferred Contact Window']) notes.push('Best time to call: ' + f['Preferred Contact Window']);
  if (f['Callback Requested']) notes.push('Asked for a callback before anything is finalised.');
  if (f['Applicant Notes']) notes.push('Their notes: ' + f['Applicant Notes']);
  notes.push('Application record: ' + app.id);
  fields['CRM Notes'] = notes.join('\n');

  return fields;
}

async function syncOnce() {
  var token = env('AIRTABLE_TOKEN');
  if (!token) {
    console.error('AIRTABLE_TOKEN is not set; approved applications were not synced.');
    return { ok: false, error: 'Airtable is not configured' };
  }

  var all = await findApproved(token);
  if (all.length === 0) return { ok: true, synced: 0 };

  var approved = [];
  var blocked = [];
  all.forEach(function (app) {
    (isVerified(app) ? approved : blocked).push(app);
  });

  // Silence here would look like a broken sync, so name what is being held back.
  blocked.forEach(function (app) {
    var name = (app.fields && (app.fields['Company Name'] || app.fields['Applicant Name'])) || app.id;
    console.warn('Holding back "' + name + '" (' + app.id + '): approved, but business ' +
      'verification has not passed. Finish the checks on the application to release it.');
  });

  if (approved.length === 0) {
    return { ok: true, synced: 0, blockedByVerification: blocked.length };
  }

  var packagesByName = await packageIdsByName(token);
  var schoolsByName = await schoolIdsByName(token);
  var synced = [];
  var failed = [];

  for (var i = 0; i < approved.length; i++) {
    var app = approved[i];
    try {
      // The slot goes first: it is idempotent, so a later failure can retry it
      // harmlessly, whereas creating the Client twice would duplicate a sponsor.
      var slot = await recordSchoolSlot(token, app, schoolsByName);

      var created = await airtable(token, HUB_BASE + '/' + CLIENTS_TBL, {
        method: 'POST',
        body: JSON.stringify({
          records: [{ fields: clientFieldsFrom(app, packagesByName) }],
          typecast: true
        })
      });
      var clientId = created.records && created.records[0] && created.records[0].id;

      // Stamp the application only after the Client exists, so a failure here
      // leaves it to be retried rather than silently dropped.
      await airtable(token, LEAD_BASE + '/' + APPS_TABLE, {
        method: 'PATCH',
        body: JSON.stringify({
          records: [{
            id: app.id,
            fields: {
              'Pushed to Deliverables Hub': true,
              'Hub Client Record': clientId || '',
              'Sales Funnel Record': slot.id || '',
              'Pushed At': new Date().toISOString()
            }
          }],
          typecast: true
        })
      });

      synced.push({
        application: app.id,
        client: clientId,
        business: slot.id,
        matchedExistingProspect: slot.matchedExistingProspect
      });
    } catch (err) {
      console.error('Could not sync application ' + app.id + ': ' + err.message);
      failed.push(app.id);
    }
  }

  return {
    ok: failed.length === 0,
    synced: synced.length,
    failed: failed.length,
    blockedByVerification: blocked.length,
    details: synced
  };
}

exports.handler = async function () {
  try {
    var result = await syncOnce();
    console.log('Approved-application sync:', JSON.stringify(result));
    return {
      statusCode: result.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error('Approved-application sync failed:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};

exports._internals = {
  clientFieldsFrom: clientFieldsFrom,
  env: env,
  isVerified: isVerified,
  recordSchoolSlot: recordSchoolSlot,
  quote: quote,
  REQUIRED_CHECKS: REQUIRED_CHECKS
};
