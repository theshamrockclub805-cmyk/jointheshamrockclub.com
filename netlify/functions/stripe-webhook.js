'use strict';

/**
 * Records Stripe payments against the Client in the Deliverables Hub.
 *
 * Marking a Client "Paid" is what releases their deliverables, so this is the
 * only thing standing between a sponsor paying and the work being scheduled.
 * Every request is checked against Stripe's signature before it is trusted —
 * the endpoint is public, so an unsigned request means nothing.
 *
 * Point a Stripe webhook endpoint at:
 *   https://jointheshamrockclub.com/.netlify/functions/stripe-webhook
 * subscribed to: checkout.session.completed,
 *                checkout.session.async_payment_succeeded,
 *                charge.refunded
 *
 * Required environment variables:
 *   STRIPE_WEBHOOK_SECRET  Signing secret for that endpoint (whsec_...)
 *   AIRTABLE_TOKEN         Token with read + write on the Hub base
 * Optional (these default to the current values):
 *   AIRTABLE_HUB_BASE_ID, AIRTABLE_HUB_CLIENTS_TABLE_ID
 */

var crypto = require('crypto');

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
var AIRTABLE_API = 'https://api.airtable.com/v0/';
var TZ = 'America/Los_Angeles';

// How far out of date a signature may be, in seconds. Stripe's own default.
var TOLERANCE_SECONDS = 300;

/**
 * Verify Stripe's Stripe-Signature header against the exact bytes we received.
 * Returns the parsed event, or throws if the request cannot be trusted.
 */
function verify(rawBody, signatureHeader, secret, nowSeconds) {
  if (!signatureHeader) throw new Error('missing signature header');

  var timestamp = null;
  var signatures = [];
  String(signatureHeader).split(',').forEach(function (part) {
    var pair = part.trim().split('=');
    if (pair[0] === 't') timestamp = pair[1];
    if (pair[0] === 'v1') signatures.push(pair[1]);
  });

  if (!timestamp || signatures.length === 0) throw new Error('malformed signature header');

  var age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) throw new Error('signature timestamp outside tolerance');

  var expected = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody, 'utf8')
    .digest('hex');
  var expectedBuf = Buffer.from(expected, 'utf8');

  var matched = signatures.some(function (candidate) {
    var candidateBuf = Buffer.from(candidate, 'utf8');
    return candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf);
  });
  if (!matched) throw new Error('signature mismatch');

  return JSON.parse(rawBody);
}

/** Today's date in Pacific time as YYYY-MM-DD, which is what Airtable date fields want. */
function pacificDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

async function airtable(token, path, options) {
  var res = await fetch(AIRTABLE_API + path, Object.assign({
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  }, options || {}));
  if (!res.ok) {
    var detail = await res.text();
    throw new Error('Airtable ' + res.status + ' on ' + path + ': ' + detail.slice(0, 300));
  }
  return res.json();
}

async function patchClient(token, clientId, fields) {
  return airtable(token, HUB_BASE + '/' + CLIENTS_TBL, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: clientId, fields: fields }], typecast: true })
  });
}

/** Find the Client a refunded charge belongs to, by the payment we stored. */
async function clientByPaymentId(token, paymentId) {
  var formula = encodeURIComponent("{Stripe Payment ID}='" + String(paymentId).replace(/'/g, "") + "'");
  var data = await airtable(token, HUB_BASE + '/' + CLIENTS_TBL + '?maxRecords=1&filterByFormula=' + formula);
  return (data.records || [])[0] || null;
}

async function handlePaid(token, session) {
  var clientId = session.client_reference_id ||
    (session.metadata && session.metadata.airtable_client_id);
  if (!clientId) {
    console.error('Stripe session ' + session.id + ' carried no Airtable client id; nothing to update.');
    return { handled: false, reason: 'no client id on session' };
  }

  var paymentId = session.payment_intent || session.id;

  var existing;
  try {
    existing = await airtable(token, HUB_BASE + '/' + CLIENTS_TBL + '/' + clientId);
  } catch (err) {
    console.error('Stripe session ' + session.id + ' points at missing client ' + clientId);
    return { handled: false, reason: 'client not found' };
  }

  var fields = existing.fields || {};
  // Stripe retries until it gets a 200, so the same payment can arrive twice.
  if (fields['Payment Status'] === 'Paid' && fields['Stripe Payment ID'] === paymentId) {
    return { handled: true, alreadyRecorded: true, client: clientId };
  }

  var today = pacificDate(new Date());
  var update = {
    'Payment Status': 'Paid',
    'Payment Method': 'Stripe',
    'Amount Paid': (session.amount_total || 0) / 100,
    'Payment Date': today,
    'Client Status': 'Active',
    'Stripe Payment ID': paymentId
  };

  // Deliverable deadlines are all counted from the start date, so it is set
  // once, on the first payment, and never moved by a later one.
  if (!fields['Sponsorship Start Date']) update['Sponsorship Start Date'] = today;

  await patchClient(token, clientId, update);
  console.log('Recorded Stripe payment ' + paymentId + ' against client ' + clientId);
  return { handled: true, client: clientId, amount: update['Amount Paid'] };
}

async function handleRefund(token, charge) {
  var paymentId = charge.payment_intent;
  var clientId = charge.metadata && charge.metadata.airtable_client_id;

  if (!clientId && paymentId) {
    var found = await clientByPaymentId(token, paymentId);
    if (found) clientId = found.id;
  }
  if (!clientId) {
    console.error('Refunded charge ' + charge.id + ' could not be matched to a client.');
    return { handled: false, reason: 'no matching client' };
  }

  var fullyRefunded = charge.amount_refunded >= charge.amount;
  await patchClient(token, clientId, {
    'Payment Status': fullyRefunded ? 'Refunded' : 'Partially paid',
    'Amount Paid': (charge.amount - charge.amount_refunded) / 100
  });
  console.log('Recorded a ' + (fullyRefunded ? 'full' : 'partial') + ' refund on client ' + clientId);
  return { handled: true, client: clientId, fullyRefunded: fullyRefunded };
}

function json(statusCode, payload) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  var secret = env('STRIPE_WEBHOOK_SECRET');
  var token = env('AIRTABLE_TOKEN');
  if (!secret || !token) {
    console.error('Stripe webhook is missing configuration:',
      'STRIPE_WEBHOOK_SECRET set =', Boolean(secret), '; AIRTABLE_TOKEN set =', Boolean(token));
    return json(503, { ok: false, error: 'Webhook is not configured' });
  }

  // The signature covers the exact bytes Stripe sent, so verify before parsing.
  var rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  var headers = event.headers || {};
  var signature = headers['stripe-signature'] || headers['Stripe-Signature'];

  var stripeEvent;
  try {
    stripeEvent = verify(rawBody, signature, secret, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error('Rejected an unverified Stripe webhook: ' + err.message);
    return json(400, { ok: false, error: 'Signature verification failed' });
  }

  try {
    var result;
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        var session = stripeEvent.data.object;
        // A completed session is not always a paid one: bank debits settle later.
        result = session.payment_status === 'paid'
          ? await handlePaid(token, session)
          : { handled: false, reason: 'session not paid yet' };
        break;
      case 'charge.refunded':
        result = await handleRefund(token, stripeEvent.data.object);
        break;
      default:
        result = { handled: false, reason: 'event type not handled' };
    }
    // Answer 200 even for events we ignore, so Stripe stops retrying them.
    return json(200, Object.assign({ ok: true, type: stripeEvent.type }, result));
  } catch (err) {
    // A 500 tells Stripe to retry, which is what we want if Airtable was down.
    console.error('Stripe webhook ' + stripeEvent.type + ' failed: ' + err.message);
    return json(500, { ok: false, error: 'Could not record the payment' });
  }
};

// Exported for local testing.
exports._internals = { env: env, verify: verify, pacificDate: pacificDate };
