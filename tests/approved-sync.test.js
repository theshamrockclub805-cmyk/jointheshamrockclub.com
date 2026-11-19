'use strict';

/**
 * The scheduled sync that turns an approved application into a paying sponsor.
 *
 * It is the only thing in this project that writes across all three Airtable
 * bases, and every failure here is expensive and quiet: a sponsor holding a
 * school slot nobody charged, a category sold twice, a founder whose free year
 * exists on paper and nowhere else.
 *
 * Each case below is something that has actually gone wrong, or that a change
 * could plausibly break without anyone noticing for weeks.
 */

const { freshRequire, clearRepoModules, alwaysWorkingTick } = require('./lib/harness');

const APPS = 'tbl79enOo6bpusR00';
const FOUNDERS = 'tblipio92Obv0kw3k';
const SCHOOLS = 'tblVcza0S27DK9pkQ';
const BUSINESSES = 'tblGeTs8cOonu2J3F';
const CLIENTS = 'tblQTVkBcVnolpo0P';
const PACKAGES = 'tblEiajhPxOQmlQ69';
const HEALTH = 'tblJSPfLUVnwEObui';

const CHECKS = {
  'Check 1: Real and operating': true,
  'Check 2: Licensed or registered': true,
  'Check 3: Appropriate for a high school audience': true,
  'Check 4: Contact can commit the business': true,
  'Check 5: Reputation clear': true,
  'Check 6: School and category available': true
};

const openSchool = {
  id: 'recRIOMESA0000001',
  fields: { 'School Name': 'Rio Mesa High School', 'Sponsor Capacity': 50, 'Application Status': 'Open to applications' }
};
const heldSchool = {
  id: 'recOXNARD00000001',
  fields: { 'School Name': 'Oxnard High School', 'Sponsor Capacity': 50, 'Application Status': 'On hold — founders first' }
};

const application = over => ({
  id: 'recAPP00000000001',
  fields: Object.assign({}, CHECKS, {
    'Application Status': 'Approved', 'Verification Status': 'Passed',
    'Confirmed Category': 'Roofer', 'Assigned Schools': ['Rio Mesa High School'],
    Email: 'new@example.com', 'Applicant Name': 'Dana Example', 'Company Name': 'Example Roofing',
    'Selected Package': 'Bronze', 'Annual Sponsorship Amount': 497
  }, over)
});

const founder = over => ({
  id: 'recFOUNDER0000001',
  fields: Object.assign({}, CHECKS, {
    'Business Name': 'A+ Bookkeeping Solutions', 'Contact Name': 'Ana Robles',
    Email: 'ana@example.com', 'Confirmation Status': 'Approved', 'Verification Status': 'Passed',
    'Confirmed Category': 'Finance & Insurance', 'Assigned Schools': ['Oxnard High School'],
    'Selected Tier': 'Silver'
  }, over)
});

/** Run one tick against a fixed world, recording every write. */
function run({ apps = [], founders = [], schools = [openSchool] }) {
  const log = [];
  global.fetch = async (url, options) => {
    options = options || {};
    const u = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const ok = records => ({ ok: true, status: 200, json: async () => ({ records }) });

    if (u.includes('api.resend.com')) { log.push('EMAIL ' + JSON.parse(options.body).to.join(',')); return { ok: true, json: async () => ({ id: 'e1' }) }; }
    if (u.includes(APPS)) {
      if (method === 'GET') { log.push('APP QUERY'); return ok(apps); }
      log.push('APP PATCH ' + Object.keys(body.records[0].fields).sort().join(','));
      return ok(body.records);
    }
    if (u.includes(FOUNDERS)) {
      if (method === 'GET') {
        log.push('FOUNDER QUERY ' + decodeURIComponent((u.split('filterByFormula=')[1] || '').split('&')[0]));
        return ok(founders);
      }
      log.push('FOUNDER PATCH ' + Object.keys(body.records[0].fields).sort().join(','));
      return ok(body.records);
    }
    if (u.includes(SCHOOLS)) { log.push('SCHOOLS FETCH'); return ok(schools); }
    if (u.includes(PACKAGES)) { log.push('PACKAGES FETCH'); return ok([{ id: 'recPKG', fields: { 'Package Name': 'Bronze' } }, { id: 'recPKGSILVER', fields: { 'Package Name': 'Silver' } }]); }
    if (u.includes(BUSINESSES)) {
      if (method === 'GET') return ok([]);
      log.push('BUSINESS ' + method);
      return ok([{ id: 'recBIZ00000000001' }]);
    }
    if (u.includes(CLIENTS) && method === 'POST') { log.push('CLIENT POST'); return ok([{ id: 'recCLIENT00000001' }]); }
    if (u.includes(HEALTH)) { log.push('HEALTH ' + body.records[0].fields['Last Result'].replace(/\n/g, ' | ')); return ok([]); }
    return ok([]);
  };
  clearRepoModules();
  const cadence = alwaysWorkingTick();
  const mod = freshRequire('netlify/functions/sync-approved.js');
  return mod.handler().then(res => {
    cadence.restore();
    return { result: JSON.parse(res.body), status: res.statusCode, log };
  });
}

module.exports = async function (t) {
  process.env.AIRTABLE_TOKEN = 'patTEST';
  process.env.RESEND_API_KEY = 'reTEST';
  process.env.MAIL_FROM = 'test@jointheshamrockclub.com';
  process.env.SITE_URL = 'https://jointheshamrockclub.com';
  const realFetch = global.fetch;

  try {
    // --- a fresh approval goes all the way through
    let r = await run({ apps: [application()] });
    t('one application is synced', r.result.synced === 1 && r.result.failed === 0, r.result);
    t('the school slot is taken before anything else',
      r.log.indexOf('BUSINESS POST') < r.log.indexOf('CLIENT POST'), r.log);
    t('a Client is created', r.log.includes('CLIENT POST'), r.log);
    t('the approval email goes out', r.log.some(l => l.startsWith('EMAIL new@example.com')), r.log);
    t('all four push fields are stamped',
      r.log.some(l => l.startsWith('APP PATCH') && ['Hub Client Record', 'Pushed At',
        'Pushed to Deliverables Hub', 'Sales Funnel Record'].every(f => l.includes(f))), r.log);

    // --- the retry hole: stamped as pushed, but the email never sent. Without
    // this branch the sponsor holds a slot and is never asked to pay.
    r = await run({ apps: [application({
      'Pushed to Deliverables Hub': true, 'Hub Client Record': 'recCLIENTEXISTING',
      'Sales Funnel Record': 'recBIZEXISTING', 'Approval Email Sent At': '' })] });
    t('a pushed-but-unemailed application retries the email',
      r.result.approvalEmailsRetried === 1, r.result);
    t('the retry creates nothing new',
      r.result.synced === 0 && !r.log.includes('CLIENT POST') && !r.log.includes('BUSINESS POST'), r.log);
    t('the retry does not take a second school slot', !r.log.includes('BUSINESS POST'), r.log);
    t('only the email timestamp is stamped',
      r.log.some(l => l === 'APP PATCH Approval Email Sent At'), r.log);

    // --- approval is not verification
    r = await run({ apps: [application({ 'Verification Status': 'Not Started', 'Check 5: Reputation clear': false })] });
    t('an unverified application is held back', r.result.blockedByVerification === 1, r.result);
    t('and takes no slot', !r.log.includes('BUSINESS POST'), r.log);
    t('and creates no Client', !r.log.includes('CLIENT POST'), r.log);
    t('and is not emailed', !r.log.some(l => l.startsWith('EMAIL')), r.log);

    // --- a half-finished checklist is not a pass, whatever the status says
    r = await run({ apps: [application({ 'Check 6: School and category available': false })] });
    t('Passed over an incomplete checklist is still held back',
      r.result.blockedByVerification === 1 && r.result.synced === 0, r.result);

    // --- a school on hold is reserved for founders, not open to walk-ins
    r = await run({ apps: [application({ 'Assigned Schools': ['Oxnard High School'] })], schools: [heldSchool] });
    t('a walk-in is refused at a held school', r.result.synced === 0 && r.result.failed === 1, r.result);
    t('no slot is spent at a held school', !r.log.includes('BUSINESS POST'), r.log);

    // --- founders are the people the hold reserves slots FOR
    r = await run({ founders: [founder()], schools: [heldSchool] });
    t('a founder passes through the hold', r.result.foundersRegistered === 1, r.result);
    t('a founder gets a Client', r.result.founderClientsCreated === 1, r.result);
    t('both ids are stamped back on the founder',
      r.log.some(l => l.startsWith('FOUNDER PATCH') && l.includes('Hub Client Record') && l.includes('Sales Funnel Record')),
      r.log);
    t('a founder is never sent a payment email', !r.log.some(l => l.startsWith('EMAIL')), r.log);
    t('the health row names the founder work',
      r.log.some(l => l.startsWith('HEALTH') && /Founding partners registered/.test(l)),
      r.log.filter(l => l.startsWith('HEALTH')));

    // --- an unverified founder is held back too
    r = await run({ founders: [founder({ 'Verification Status': 'Not Started' })], schools: [heldSchool] });
    t('an unverified founder takes no slot',
      r.result.foundersRegistered === 0 && r.result.foundersBlocked === 1, r.result);

    // --- half-done founder: slot taken, Client never created
    r = await run({ founders: [founder({ 'Sales Funnel Record': 'recBIZEXISTING' })], schools: [heldSchool] });
    t('a half-done founder takes no second slot',
      r.result.foundersRegistered === 0 && !r.log.includes('BUSINESS POST'), r.log);
    t('and the missing Client is created', r.result.founderClientsCreated === 1, r.result);
    t('the founder query asks for either step outstanding',
      r.log.some(l => l.startsWith('FOUNDER QUERY') && l.includes("{Sales Funnel Record}=''")
        && l.includes("{Hub Client Record}=''")), r.log);

    // --- a failure has to explain itself; "failed: 1" alone sends someone to
    // logs they cannot reach
    r = await run({ founders: [founder()], schools: [openSchool] });
    t('a founder whose school cannot be resolved fails', r.result.failed === 1, r.result);
    t('and the health row names them and the reason',
      r.log.some(l => l.startsWith('HEALTH') && l.includes('A+ Bookkeeping Solutions') && /no school named/.test(l)),
      r.log.filter(l => l.startsWith('HEALTH')));
    t('a failing run is not reported healthy', r.result.ok === false, r.result.ok);

    // --- an idle tick is the common case and must stay cheap: the monthly
    // Airtable cap is the binding constraint on this whole design
    r = await run({});
    t('an idle tick fetches no schools', !r.log.includes('SCHOOLS FETCH'), r.log);
    t('an idle tick fetches no packages', !r.log.includes('PACKAGES FETCH'), r.log);
    t('an idle tick writes nothing',
      !r.log.some(l => /POST|PATCH/.test(l) && !l.startsWith('HEALTH')), r.log);
    t('an idle tick still reports a full result shape',
      ['ok', 'synced', 'approvalEmailsRetried', 'failed', 'blockedByVerification']
        .every(k => r.result[k] !== undefined), r.result);
    t('an idle tick leaves founders out of the health row',
      !r.log.some(l => l.startsWith('HEALTH') && /Founding partners/.test(l)),
      r.log.filter(l => l.startsWith('HEALTH')));

    // --- the query itself is what stops a sponsor being emailed twice
    r = await run({ apps: [] });
    t('the query excludes anything already emailed', r.log.includes('APP QUERY'), r.log);
  } finally {
    global.fetch = realFetch;
  }
};
