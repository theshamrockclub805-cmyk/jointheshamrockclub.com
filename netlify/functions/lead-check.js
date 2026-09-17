'use strict';

/**
 * TEMPORARY diagnostic endpoint: /.netlify/functions/lead-check
 *
 * Reports whether the Airtable credentials reached the function runtime, and
 * whether Airtable accepts them. It never returns the token or any part of it.
 *
 * Delete this file once the integration is confirmed working.
 */

var BASE_ID = process.env.AIRTABLE_BASE_ID || 'appiaYFwD340oK6uQ';

exports.handler = async function () {
  var token = process.env.AIRTABLE_TOKEN;

  // Names only (never values), to catch a typo'd or differently-named variable.
  var airtableVarNames = Object.keys(process.env)
    .filter(function (name) { return /airtable/i.test(name); })
    .sort();

  var report = {
    tokenPresent: !!token,
    tokenLength: token ? token.length : 0,
    tokenHasWhitespace: token ? /^\s|\s$/.test(token) : false,
    tokenLooksLikePersonalAccessToken: token ? token.slice(0, 3) === 'pat' : false,
    airtableEnvVarNamesVisible: airtableVarNames,
    baseIdInUse: BASE_ID,
    airtableSaysToken: 'not checked'
  };

  if (token) {
    try {
      // whoami needs no special scope: it just proves the token is real.
      var who = await fetch('https://api.airtable.com/v0/meta/whoami', {
        headers: { 'Authorization': 'Bearer ' + token.trim() }
      });
      var body = await who.json().catch(function () { return {}; });
      report.airtableSaysToken = who.status === 200 ? 'valid' : 'rejected (HTTP ' + who.status + ')';
      if (body && body.scopes) report.tokenScopes = body.scopes;
      if (who.status !== 200 && body && body.error) {
        report.airtableError = typeof body.error === 'string' ? body.error : body.error.type;
      }
    } catch (err) {
      report.airtableSaysToken = 'could not reach Airtable: ' + err.message;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(report, null, 2)
  };
};
