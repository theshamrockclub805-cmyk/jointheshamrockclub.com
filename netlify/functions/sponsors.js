'use strict';

/**
 * Public sponsor directory data.
 *
 * Every tier includes a listing on the Shamrock website, so this is the
 * endpoint that actually delivers that promise. It is unauthenticated and
 * CORS-open on purpose: the directory is meant to be embedded anywhere,
 * including the main shamrockclub.net site, which is a different origin.
 *
 * Because it is public, fields are copied out one by one into a fresh object.
 * Airtable records are never passed through, so a contact email, an amount
 * paid, a Stripe payment id or a CRM note cannot leak by accident when
 * someone later adds a field to the Clients table.
 *
 * Required environment variables:
 *   AIRTABLE_TOKEN   read access to the Client Deliverables Hub
 * Optional (these default to the current values):
 *   AIRTABLE_HUB_BASE_ID, AIRTABLE_HUB_CLIENTS_TABLE_ID
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

var HUB_BASE    = env('AIRTABLE_HUB_BASE_ID') || 'appGG8camPZ04Tsz6';
var CLIENTS_TBL = env('AIRTABLE_HUB_CLIENTS_TABLE_ID') || 'tblQTVkBcVnolpo0P';
var API = 'https://api.airtable.com/v0/';

// Biggest commitment first. Anything unrecognised sorts last but still shows.
var TIER_ORDER = [
  'District Champion',
  'District Leader',
  'District Partner',
  'Gold',
  'Silver',
  'Bronze'
];

function tierRank(name) {
  var index = TIER_ORDER.indexOf(name);
  return index === -1 ? TIER_ORDER.length : index;
}

/** Only ever show a sponsor who has paid, is still active, and was published. */
var FILTER = "AND(" +
  "{Payment Status}='Paid', " +
  "{Show in Directory}, " +
  "{Client Status}!='Offboarded'" +
  ")";

function firstAttachmentUrl(value) {
  if (!Array.isArray(value) || value.length === 0) return '';
  var file = value[0];
  // Prefer a resized copy so the page is not loading full-size originals.
  var thumb = file && file.thumbnails && file.thumbnails.large;
  return (thumb && thumb.url) || (file && file.url) || '';
}

/** Only https/http links, so a malformed value cannot become a javascript: URL. */
function safeUrl(value) {
  var url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * Copy the handful of public fields into a new object. Adding a field to the
 * Clients table can never widen what this returns.
 */
function publicSponsor(record) {
  var f = record.fields || {};

  var packages = f['Selected Package'];
  var tier = '';
  if (Array.isArray(packages) && packages.length) {
    tier = typeof packages[0] === 'object' ? (packages[0].name || '') : String(packages[0]);
  }

  return {
    name: String(f['Business Name'] || f['Company Name'] || '').trim(),
    tier: tier.trim(),
    schools: String(f['Sponsored School(s)'] || '').trim(),
    website: safeUrl(f['Sponsor Website']),
    logo: firstAttachmentUrl(f['Sponsor Logo'])
  };
}

function json(statusCode, payload, cacheSeconds) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Public data, embedded from other origins (the main website).
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': cacheSeconds
        ? 'public, max-age=' + cacheSeconds + ', stale-while-revalidate=600'
        : 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  var token = env('AIRTABLE_TOKEN');
  if (!token) {
    console.error('AIRTABLE_TOKEN is not set; the sponsor directory cannot be built.');
    return json(503, { ok: false, error: 'Directory is not configured yet' });
  }

  var records = [];
  var offset = '';
  try {
    // Paginate, so the directory does not silently stop at 100 sponsors.
    do {
      var path = HUB_BASE + '/' + CLIENTS_TBL +
        '?pageSize=100&filterByFormula=' + encodeURIComponent(FILTER) +
        (offset ? '&offset=' + encodeURIComponent(offset) : '');

      var res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) {
        var detail = await res.text();
        throw new Error('Airtable ' + res.status + ': ' + detail.slice(0, 200));
      }
      var page = await res.json();
      records = records.concat(page.records || []);
      offset = page.offset || '';
    } while (offset);
  } catch (err) {
    console.error('Could not load sponsors:', err.message);
    return json(502, { ok: false, error: 'Could not load the sponsor list' });
  }

  var sponsors = records
    .map(publicSponsor)
    .filter(function (s) { return s.name; })
    .sort(function (a, b) {
      return tierRank(a.tier) - tierRank(b.tier) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });

  // Five minutes: new sponsors appear promptly, without hitting Airtable per visitor.
  return json(200, { ok: true, count: sponsors.length, sponsors: sponsors }, 300);
};

exports._internals = {
  env: env,
  publicSponsor: publicSponsor,
  safeUrl: safeUrl,
  firstAttachmentUrl: firstAttachmentUrl,
  tierRank: tierRank,
  TIER_ORDER: TIER_ORDER
};
