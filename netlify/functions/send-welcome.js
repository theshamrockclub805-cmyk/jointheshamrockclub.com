'use strict';

/**
 * Welcomes sponsors once their payment has landed.
 *
 * This watches Airtable rather than hanging off the Stripe webhook, because
 * plenty of sponsorships are paid by cash or cheque and recorded by hand. Both
 * routes end at the same place — Payment Status becomes Paid — so watching that
 * field welcomes everyone the same way.
 *
 * Runs on a schedule. Welcome Email Sent At is both the filter and the guard,
 * so a sponsor is welcomed exactly once, and only stamped after the send
 * actually succeeded.
 *
 * Required environment variables:
 *   AIRTABLE_TOKEN, RESEND_API_KEY, MAIL_FROM
 * Optional:
 *   AIRTABLE_HUB_BASE_ID, AIRTABLE_HUB_CLIENTS_TABLE_ID
 */

var mailer = require('../lib/mailer');
var emails = require('../lib/emails');

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

var HUB_BASE    = env('AIRTABLE_HUB_BASE_ID') || 'appGG8camPZ04Tsz6';
var CLIENTS_TBL = env('AIRTABLE_HUB_CLIENTS_TABLE_ID') || 'tblQTVkBcVnolpo0P';
var API = 'https://api.airtable.com/v0/';

var FILTER = "AND({Payment Status}='Paid', NOT({Welcome Email Sent At}))";

async function airtable(token, path, options) {
  var res = await fetch(API + path, Object.assign({
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  }, options || {}));
  if (!res.ok) {
    var detail = await res.text();
    throw new Error('Airtable ' + res.status + ' on ' + path + ': ' + detail.slice(0, 200));
  }
  return res.json();
}

function selectName(value) {
  return value && typeof value === 'object' ? value.name : value;
}

/**
 * A date a person would read.
 *
 * Airtable date fields arrive as "2026-09-18", which Date parses as UTC
 * midnight. Formatting that in Pacific rolls it back a day, which would tell a
 * sponsor their year began the day before it did. A date-only value is a
 * calendar date rather than an instant, so it is formatted in UTC and left
 * alone. A full timestamp is a real moment, so that one is shown in Pacific.
 */
function readableDate(value) {
  if (!value) return '';
  var raw = String(value).trim();
  var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);

  var date = new Date(dateOnly ? raw + 'T00:00:00Z' : raw);
  if (isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: dateOnly ? 'UTC' : 'America/Los_Angeles',
    month: 'long', day: 'numeric', year: 'numeric'
  }).format(date);
}

function welcomeFor(client) {
  var f = client.fields || {};
  var packages = f['Selected Package'];
  var tier = '';
  if (Array.isArray(packages) && packages.length) {
    tier = selectName(packages[0]) || String(packages[0]);
  }

  return emails.paymentWelcome({
    email: f['Contact Email'],
    contactName: f['Business Name'] || f['Company Name'],
    packageName: tier,
    schools: f['Sponsored School(s)'] || '',
    startDate: readableDate(f['Sponsorship Start Date'])
  });
}

async function runOnce() {
  var token = env('AIRTABLE_TOKEN');
  if (!token) {
    console.error('AIRTABLE_TOKEN is not set; no welcome emails were sent.');
    return { ok: false, error: 'Airtable is not configured' };
  }

  var data;
  try {
    data = await airtable(token,
      HUB_BASE + '/' + CLIENTS_TBL + '?pageSize=50&filterByFormula=' + encodeURIComponent(FILTER));
  } catch (err) {
    console.error('Could not look for newly paid sponsors: ' + err.message);
    return { ok: false, error: err.message };
  }

  var clients = data.records || [];
  if (clients.length === 0) return { ok: true, welcomed: 0 };

  var welcomed = 0;
  var skipped = 0;

  for (var i = 0; i < clients.length; i++) {
    var client = clients[i];
    var name = (client.fields && client.fields['Business Name']) || client.id;

    if (!client.fields || !client.fields['Contact Email']) {
      console.warn('Paid sponsor "' + name + '" (' + client.id + ') has no contact email; not welcomed.');
      skipped++;
      continue;
    }

    var sent = await mailer.send(welcomeFor(client));
    if (!sent.sent) {
      // Left unstamped on purpose, so the next run tries again.
      console.error('Welcome email to "' + name + '" failed (' + sent.reason + '); will retry.');
      skipped++;
      continue;
    }

    try {
      await airtable(token, HUB_BASE + '/' + CLIENTS_TBL, {
        method: 'PATCH',
        body: JSON.stringify({
          records: [{ id: client.id, fields: { 'Welcome Email Sent At': new Date().toISOString() } }]
        })
      });
      welcomed++;
    } catch (err) {
      console.error('Welcomed "' + name + '" but could not stamp it: ' + err.message +
        '. It may send again next run.');
      welcomed++;
    }
  }

  return { ok: true, welcomed: welcomed, skipped: skipped };
}

exports.handler = async function () {
  try {
    var result = await runOnce();
    if (result.welcomed || result.skipped) console.log('Welcome emails:', JSON.stringify(result));
    return {
      statusCode: result.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error('Welcome email run failed: ' + err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};

exports._internals = { welcomeFor: welcomeFor, readableDate: readableDate, env: env };
