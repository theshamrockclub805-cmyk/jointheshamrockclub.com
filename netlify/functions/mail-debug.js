'use strict';

/**
 * TEMPORARY DIAGNOSTIC — DELETE ONCE THE EMAIL PROBLEM IS SOLVED.
 *
 * Netlify only gives a function the environment captured at build time, so
 * "the variable is set in the dashboard" and "the function can see it" are
 * different questions. This answers the second one, and asks Resend directly
 * whether the sending domain is verified for this API key.
 *
 * It never returns a secret: presence and length only, which is enough to
 * catch a missing, truncated, or quote-wrapped value. It sends no mail.
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

/** Presence and shape, never the value. */
function describe(name, opts) {
  var raw = process.env[name];
  var trimmed = env(name);
  var out = {
    set: Boolean(trimmed),
    length: trimmed ? trimmed.length : 0
  };
  if (raw !== undefined && raw !== trimmed) out.hadSurroundingWhitespace = true;
  if (trimmed && /^['"]|['"]$/.test(trimmed)) out.looksQuoted = true;
  // These two are not secrets: the from address is in every email header and
  // the site URL is the site itself.
  if (opts && opts.safeToShow && trimmed) out.value = trimmed;
  return out;
}

exports.handler = async function () {
  var report = {
    note: 'Temporary diagnostic. Delete netlify/functions/mail-debug.js once resolved.',
    deployedAt: new Date().toISOString(),
    env: {
      RESEND_API_KEY: describe('RESEND_API_KEY'),
      MAIL_FROM: describe('MAIL_FROM', { safeToShow: true }),
      MAIL_REPLY_TO: describe('MAIL_REPLY_TO', { safeToShow: true }),
      MAIL_BCC: describe('MAIL_BCC'),
      SITE_URL: describe('SITE_URL', { safeToShow: true }),
      AIRTABLE_TOKEN: describe('AIRTABLE_TOKEN')
    }
  };

  var key = env('RESEND_API_KEY');
  if (!key) {
    report.resend = { checked: false, why: 'RESEND_API_KEY is not visible to this function.' };
    return json(report);
  }

  // Ask Resend what it thinks, rather than guessing from DNS.
  try {
    var res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer ' + key }
    });
    var body = await res.json().catch(function () { return {}; });

    report.resend = { checked: true, status: res.status };
    if (res.status === 401 || res.status === 403) {
      report.resend.diagnosis = 'Resend rejected the API key.';
      report.resend.message = body && body.message;
    } else if (!res.ok) {
      report.resend.message = body && body.message;
    } else {
      var domains = (body && body.data) || [];
      report.resend.domains = domains.map(function (d) {
        return { name: d.name, status: d.status, region: d.region };
      });
      var from = env('MAIL_FROM') || '';
      var at = from.lastIndexOf('@');
      var sendingDomain = at === -1 ? '' : from.slice(at + 1).replace(/>$/, '').trim();
      report.resend.sendingDomain = sendingDomain;
      var match = domains.find(function (d) { return d.name === sendingDomain; });
      report.resend.diagnosis = !sendingDomain
        ? 'MAIL_FROM has no domain to check.'
        : !match
          ? 'MAIL_FROM sends from "' + sendingDomain + '", which is not a domain on this Resend account.'
          : match.status === 'verified'
            ? 'Sending domain is verified. Mail should send.'
            : 'Sending domain "' + sendingDomain + '" is "' + match.status + '", not verified.';
    }
  } catch (err) {
    report.resend = { checked: true, error: err.message };
  }

  return json(report);
};

function json(report) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(report, null, 2)
  };
}
