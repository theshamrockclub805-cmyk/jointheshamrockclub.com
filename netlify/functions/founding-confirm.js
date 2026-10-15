'use strict';

/**
 * Receives a founding member's confirmation from /founding-partner.html and
 * creates the matching record in the "Founding Partners" table.
 *
 * Every field here is part of a signed membership agreement, so this endpoint
 * only reports success once Airtable has actually stored the record. The logo
 * upload and the confirmation email are best-effort and happen after that:
 * neither is worth losing a signature over.
 *
 * Required environment variables:
 *   AIRTABLE_TOKEN    Personal access token with data.records:write on the base
 * Optional:
 *   AIRTABLE_BASE_ID, AIRTABLE_FOUNDING_TABLE_ID
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

var mailer = require('../lib/mailer');
var emails = require('../lib/emails');

var BASE_ID = env('AIRTABLE_BASE_ID') || 'appiaYFwD340oK6uQ';
var FOUNDING_TABLE = env('AIRTABLE_FOUNDING_TABLE_ID') || 'tblipio92Obv0kw3k';

// A logo can legitimately be a couple of MB, and base64 adds a third on top.
// Netlify's own limit is 6MB, so cap below it rather than letting the platform
// return an opaque error.
var MAX_BODY_BYTES = 5 * 1024 * 1024;
var MAX_LOGO_BYTES = 3 * 1024 * 1024;

// The founding-partner prices, held for 2027-28 and 2028-29. Kept here rather
// than taken from the browser: a posted price is a price anyone can edit.
var TIERS = {
  'bronze': { label: 'Bronze',           price: 497 },
  'silver': { label: 'Silver',           price: 748 },
  'gold':   { label: 'Gold',             price: 1498 },
  'multi':  { label: 'Multiple schools', price: null }
};

var CATEGORIES = [
  'Restaurant & café', 'Retail & shops', 'Professional services',
  'Personal care & wellness', 'Home & trade services', 'Automotive', 'Other'
];

var YEARS = ['Before 2022', '2022', '2023', '2024', '2025', '2026', 'Not sure'];

function clean(value, maxLength) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength || 500);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(value);
}

/**
 * The license/EIN box is free text. Mirror the application form's rule and
 * drop anything shaped like a Social Security number, so an SSN is never
 * stored even if someone types one in by mistake.
 */
function cleanLicense(value) {
  var v = clean(value, 100);
  if (/^\d{3}[- ]\d{2}[- ]\d{4}$/.test(v)) return '';
  return v;
}

/** Only accept a value the table already offers, so typos cannot invent options. */
function oneOf(value, allowed) {
  var v = clean(value, 100);
  return allowed.indexOf(v) === -1 ? '' : v;
}

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function buildRecord(data, tier, now) {
  var fields = {
    'Business Name': clean(data.bizName, 200),
    'Display Name': clean(data.displayName, 200),
    'Business Category': oneOf(data.category, CATEGORIES),
    'Year Joined': oneOf(data.joined, YEARS),
    'Business License or EIN': cleanLicense(data.ein),
    'Website': clean(data.website, 500),
    'Contact Name': clean(data.contactName, 200),
    'Email': clean(data.email, 200),
    'Phone': clean(data.phone, 40),
    'Billing Email': isEmail(clean(data.billingEmail, 200)) ? clean(data.billingEmail, 200) : '',
    'Selected Tier': tier.label,
    'Notes from Member': clean(data.notes, 2000),
    'Signature Name': clean(data.signature, 200),
    'Agreed to Membership Agreement': data.agree === true,
    'Logo & Name Use Consent': data.license === true,
    'Member ID': clean(data.memberId, 100),
    'Confirmation Status': 'Submitted',
    'Verification Status': 'Not Started',
    'Submitted At': now.toISOString(),
    'UTM Source': clean(data.utm_source, 200),
    'UTM Medium': clean(data.utm_medium, 200),
    'UTM Campaign': clean(data.utm_campaign, 200),
    'UTM Content': clean(data.utm_content, 200),
    'Referring Site': clean(data.referrer, 200),
    'Landing Page': clean(data.landing_page, 200)
  };

  // Multiple schools has no locked price yet, and writing 0 would read as free.
  if (tier.price !== null) fields['Locked Annual Price'] = tier.price;

  // Trust the server's date over the browser's clock, but keep the signing date
  // the member actually saw if it is sane.
  var signed = clean(data.signDate, 10);
  fields['Signature Date'] = /^\d{4}-\d{2}-\d{2}$/.test(signed)
    ? signed
    : now.toISOString().slice(0, 10);

  // Every founding partner on this page is an Oxnard High School member. The
  // team still has to confirm it as part of check 6, but pre-filling it means
  // the verification gate is not blocked on retyping what we already know.
  fields['Assigned Schools'] = ['Oxnard High School'];

  Object.keys(fields).forEach(function (key) {
    if (fields[key] === '') delete fields[key];
  });
  return fields;
}

/**
 * Attach the logo through Airtable's upload endpoint, which takes the file
 * inline. The alternative needs a publicly reachable URL, which we do not have
 * for something that was just posted from a browser.
 */
async function uploadLogo(token, recordId, logo) {
  var base64 = String(logo.data || '');
  var comma = base64.indexOf(',');
  if (base64.slice(0, 5) === 'data:' && comma !== -1) base64 = base64.slice(comma + 1);
  if (!base64) return;

  var bytes = Math.floor(base64.length * 3 / 4);
  if (bytes > MAX_LOGO_BYTES) {
    console.warn('Logo for ' + recordId + ' is ' + bytes + ' bytes; skipped.');
    return;
  }
  if (!/^image\//.test(String(logo.type || ''))) {
    console.warn('Logo for ' + recordId + ' is not an image; skipped.');
    return;
  }

  var res = await fetch(
    'https://content.airtable.com/v0/' + BASE_ID + '/' + recordId + '/Logo/uploadAttachment', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: clean(logo.type, 100),
        filename: clean(logo.name, 200) || 'logo',
        file: base64
      })
    });

  if (!res.ok) {
    var detail = await res.text();
    throw new Error('Airtable refused the logo: ' + res.status + ' ' + detail.slice(0, 200));
  }
}

/** Stamped only after the email sends, so a failure can be spotted and retried. */
async function stampConfirmation(token, recordId) {
  try {
    await fetch('https://api.airtable.com/v0/' + BASE_ID + '/' + FOUNDING_TABLE, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ id: recordId, fields: { 'Confirmation Email Sent At': new Date().toISOString() } }]
      })
    });
  } catch (err) {
    console.error('Could not stamp the confirmation email time: ' + err.message);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }
  if (!event.body || Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: 'Request body missing or too large' });
  }

  var data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  // Honeypot: real people never fill this in.
  if (clean(data.companyWebsite, 200)) {
    return json(200, { ok: true, skipped: 'spam' });
  }

  // Re-check everything the page checks. The browser's validation is a
  // courtesy to the member; this is what actually protects the record.
  var email = clean(data.email, 200);
  var tier = TIERS[clean(data.interest, 40)];
  var missing = [];

  if (!clean(data.bizName, 200)) missing.push('business name');
  if (!oneOf(data.category, CATEGORIES)) missing.push('business category');
  if (!oneOf(data.joined, YEARS)) missing.push('year joined');
  if (!cleanLicense(data.ein)) missing.push('business license or EIN');
  if (!isHttpUrl(clean(data.website, 500))) missing.push('website');
  if (!clean(data.contactName, 200)) missing.push('contact name');
  if (!isEmail(email)) missing.push('a valid email address');
  if (!tier) missing.push('a tier');
  if (!clean(data.signature, 200)) missing.push('a signature');
  if (data.agree !== true) missing.push('agreement to the membership agreement');
  if (data.license !== true) missing.push('consent to list your business');

  if (missing.length) {
    return json(400, { ok: false, error: 'Please complete: ' + missing.join(', ') + '.' });
  }

  var token = env('AIRTABLE_TOKEN');
  if (!token) {
    console.error('AIRTABLE_TOKEN is not set; a founding partner confirmation was not saved.');
    return json(503, { ok: false, error: 'Airtable is not configured yet' });
  }

  var now = new Date();
  var response;
  try {
    response = await fetch('https://api.airtable.com/v0/' + BASE_ID + '/' + FOUNDING_TABLE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ fields: buildRecord(data, tier, now) }],
        typecast: true
      })
    });
  } catch (err) {
    console.error('Airtable request failed:', err.message);
    return json(502, { ok: false, error: 'Could not reach Airtable' });
  }

  if (!response.ok) {
    var detail = await response.text();
    console.error('Airtable rejected the confirmation:', response.status, detail);
    return json(502, { ok: false, error: 'Airtable rejected the record' });
  }

  var result = await response.json();
  var recordId = result.records && result.records[0] && result.records[0].id;

  // The signature is safe from here on. Everything below can fail without
  // costing the member their confirmation, so none of it changes the response.
  if (recordId && data.logo && data.logo.data) {
    try {
      await uploadLogo(token, recordId, data.logo);
    } catch (err) {
      console.error('Logo upload failed for ' + recordId + ': ' + err.message +
        ' (the confirmation itself was saved).');
    }
  }

  var sent = await mailer.send(emails.foundingPartnerConfirmed({
    email: email,
    contactName: clean(data.contactName, 200),
    businessName: clean(data.bizName, 200),
    tier: tier.label,
    lockedPrice: tier.price,
    signatureName: clean(data.signature, 200),
    signatureDate: clean(data.signDate, 10)
  }));

  if (sent.sent && recordId) {
    await stampConfirmation(token, recordId);
  } else if (!sent.sent) {
    console.warn('Founding partner ' + recordId + ' was saved but the confirmation email did not ' +
      'send (' + sent.reason + '). Confirmation Email Sent At is empty for follow-up.');
  }

  return json(200, { ok: true, id: recordId });
};

// Exported for local testing.
exports._internals = {
  env: env,
  buildRecord: buildRecord,
  cleanLicense: cleanLicense,
  oneOf: oneOf,
  TIERS: TIERS,
  CATEGORIES: CATEGORIES,
  YEARS: YEARS
};
