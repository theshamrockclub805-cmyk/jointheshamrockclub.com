'use strict';

/**
 * The Automation Health heartbeat on send-welcome.
 *
 * A sponsor who has paid and heard nothing is the quietest failure in this
 * system. They are not chasing us, because as far as they know they are
 * waiting on nobody, and nothing in Airtable looks wrong: the Client record is
 * marked Paid, the welcome timestamp is simply empty - which is also what it
 * looks like thirty seconds after a successful payment.
 *
 * So the heartbeat has to be written on every working tick, including the
 * ticks that find nobody to welcome. "The job ran and there was nothing to do"
 * and "the job stopped running three weeks ago" must not look the same.
 *
 * These also pin the two rules that make a health row trustworthy: it carries
 * the reason a sponsor was missed, not just a count, and it can never itself
 * break the run it is reporting on.
 */

const { freshRequire, clearRepoModules, alwaysWorkingTick, repoPath } = require('./lib/harness');

const CLIENTS = 'tblQTVkBcVnolpo0P';
const HEALTH = 'tblJSPfLUVnwEObui';
const LEAD_BASE = 'appiaYFwD340oK6uQ';

const paidClient = over => ({
  id: 'recCLIENT00000001',
  fields: Object.assign({
    'Business Name': 'JM PAINTING',
    'Contact Email': 'jm@example.com',
    'Selected Package': ['Bronze'],
    'Sponsored School(s)': 'Rio Mesa High School',
    'Sponsorship Start Date': '2026-09-18',
    'Payment Status': 'Paid'
  }, over)
});

/**
 * Run one tick against a fixed world.
 *
 * `health` picks what the Automation Health table does: 'ok', or 'broken' to
 * reject the write. `mail` picks what the provider does: 'ok', 'reject' for a
 * declined send, or 'throw' for an unexpected exception, which is the only way
 * to reach the handler's catch - mailer.send is contractually incapable of
 * throwing at its caller.
 */
function run({ clients = [], health = 'ok', mail = 'ok', token = 'patTEST' } = {}) {
  const log = [];
  const rows = [];
  global.fetch = async (url, options) => {
    options = options || {};
    const u = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const ok = payload => ({ ok: true, status: 200, json: async () => payload });

    if (u.includes(HEALTH)) {
      log.push('HEALTH ' + method);
      rows.push({ url: u, body: body });
      if (health === 'broken') {
        return { ok: false, status: 422, text: async () => 'INVALID_REQUEST_UNKNOWN field "Function"' };
      }
      return ok({ records: [] });
    }
    if (u.includes('api.resend.com')) {
      if (mail === 'throw') throw new Error('socket hang up');
      log.push('EMAIL ' + JSON.parse(options.body).to.join(','));
      if (mail === 'reject') {
        return { ok: false, status: 403,
                 json: async () => ({ message: 'The jointheshamrockclub.com domain is not verified.' }),
                 text: async () => 'domain not verified' };
      }
      return ok({ id: 'e1' });
    }
    if (u.includes(CLIENTS)) {
      if (method === 'GET') { log.push('CLIENT QUERY'); return ok({ records: clients }); }
      log.push('CLIENT PATCH ' + Object.keys(body.records[0].fields).join(','));
      return ok({ records: body.records });
    }
    return ok({});
  };

  clearRepoModules();
  const cadence = alwaysWorkingTick();

  // mailer.send never throws by contract, so an unexpected exception has to be
  // injected to exercise the crash path at all.
  if (mail === 'throw') {
    const mailerPath = require.resolve(repoPath('netlify/lib/mailer.js'));
    const real = require(mailerPath);
    require.cache[mailerPath] = {
      id: mailerPath, filename: mailerPath, loaded: true,
      exports: Object.assign({}, real, {
        send: async () => { throw new Error('socket hang up'); }
      })
    };
  }

  if (token) process.env.AIRTABLE_TOKEN = token; else delete process.env.AIRTABLE_TOKEN;

  const mod = freshRequire('netlify/functions/send-welcome.js');
  return mod.handler().then(res => {
    cadence.restore();
    clearRepoModules();
    return { result: JSON.parse(res.body), status: res.statusCode, log, rows };
  });
}

const lastRow = r => r.rows.length ? r.rows[r.rows.length - 1].body.records[0].fields : null;

module.exports = async function (t) {
  const realFetch = global.fetch;
  const realToken = process.env.AIRTABLE_TOKEN;
  process.env.RESEND_API_KEY = 'reTEST';
  process.env.MAIL_FROM = 'test@jointheshamrockclub.com';
  process.env.SITE_URL = 'https://jointheshamrockclub.com';

  try {
    // --- the whole point: a tick with nothing to do still reports in
    let r = await run({ clients: [] });
    t('an empty tick still writes a heartbeat', r.log.includes('HEALTH PATCH'), r.log);
    t('and sends no email', !r.log.some(l => l.startsWith('EMAIL')), r.log);
    t('and says plainly that it welcomed nobody',
      /Welcomed: 0, not welcomed: 0\./.test(lastRow(r)['Last Result']), lastRow(r));
    t('an empty tick reports a full result shape',
      ['ok', 'welcomed', 'skipped'].every(k => r.result[k] !== undefined), r.result);

    // --- the row has to be this function's own, and has to be reused
    t('the row is keyed to send-welcome', lastRow(r)['Function'] === 'send-welcome', lastRow(r));
    t('it upserts rather than piling up rows',
      r.rows[0].body.performUpsert &&
      r.rows[0].body.performUpsert.fieldsToMergeOn.join() === 'Function', r.rows[0].body);
    t('it lands in the Lead base, not the Hub base the rest of this job uses',
      r.rows[0].url.includes(LEAD_BASE + '/' + HEALTH), r.rows[0].url);
    t('Last Run At is stamped', Boolean(lastRow(r)['Last Run At']), lastRow(r));
    t('the timestamp in the text matches the one in the field',
      lastRow(r)['Last Result'].includes(lastRow(r)['Last Run At']), lastRow(r));

    // --- a successful welcome
    r = await run({ clients: [paidClient()] });
    t('a paid sponsor is welcomed', r.result.welcomed === 1, r.result);
    t('and the welcome timestamp is stamped',
      r.log.includes('CLIENT PATCH Welcome Email Sent At'), r.log);
    t('and the health row counts it', /Welcomed: 1/.test(lastRow(r)['Last Result']), lastRow(r));

    // --- a count with no reason sends someone to logs they cannot reach
    r = await run({ clients: [paidClient()], mail: 'reject' });
    t('a declined send is not counted as welcomed',
      r.result.welcomed === 0 && r.result.skipped === 1, r.result);
    t('the health row names the sponsor',
      lastRow(r)['Last Result'].includes('JM PAINTING'), lastRow(r));
    t('and the reason, in the provider\'s own words rather than a status code',
      /domain is not verified/.test(lastRow(r)['Last Result']), lastRow(r));
    t('and says it will try again',
      /will retry/.test(lastRow(r)['Last Result']), lastRow(r));
    t('a failed send is left unstamped so the next run retries it',
      !r.log.some(l => l.startsWith('CLIENT PATCH')), r.log);

    // --- a sponsor with nowhere to send to is a data problem, and silent
    r = await run({ clients: [paidClient({ 'Contact Email': '' })] });
    t('a sponsor with no contact email is skipped', r.result.skipped === 1, r.result);
    t('and the health row says exactly that',
      /no contact email/.test(lastRow(r)['Last Result']) &&
      lastRow(r)['Last Result'].includes('recCLIENT00000001'), lastRow(r));

    // --- a crash is the case most worth recording
    r = await run({ clients: [paidClient()], mail: 'throw' });
    t('a crashing run still writes a heartbeat', r.log.includes('HEALTH PATCH'), r.log);
    t('and the row carries the error', /Run failed before finishing/.test(lastRow(r)['Last Result']),
      lastRow(r));
    t('and the handler still reports the failure', r.status === 500, r.status);

    // --- health reporting must never break the thing it reports on
    r = await run({ clients: [paidClient()], health: 'broken' });
    t('a broken health table does not fail the run', r.status === 200, r.status);
    t('and the sponsor is still welcomed', r.result.welcomed === 1, r.result);

    // --- no token means no write is even attempted
    r = await run({ clients: [], token: null });
    t('with no Airtable token nothing is written', !r.log.includes('HEALTH PATCH'), r.log);
    t('and the run reports itself unconfigured',
      r.result.ok === false && /not configured/.test(r.result.error || ''), r.result);
  } finally {
    global.fetch = realFetch;
    if (realToken === undefined) delete process.env.AIRTABLE_TOKEN;
    else process.env.AIRTABLE_TOKEN = realToken;
    clearRepoModules();
  }
};
