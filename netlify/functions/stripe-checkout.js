'use strict';

/**
 * Creates a Stripe Checkout session for a sponsor and sends them to it.
 *
 * The team does not hand-build payment links. Every Client in the Deliverables
 * Hub has a "Stripe Checkout Link" pointing here with its own record id, so a
 * sponsor can be sent their link the moment their application is approved:
 *
 *   https://jointheshamrockclub.com/pay?client=recXXXXXXXXXXXXXX
 *
 * The price comes from the package linked to that Client, so the amount can
 * never drift from what the Packages table says the tier costs.
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY   Stripe secret key (sk_live_... or sk_test_...)
 *   AIRTABLE_TOKEN      Personal access token with read access to the Hub base
 * Optional (these default to the current values):
 *   SITE_URL, AIRTABLE_HUB_BASE_ID, AIRTABLE_HUB_CLIENTS_TABLE_ID,
 *   AIRTABLE_HUB_PACKAGES_TABLE_ID
 */

/**
 * Read an environment variable, tolerating a different capitalisation of the
 * name and surrounding whitespace in the value. Hosting dashboards make both
 * mistakes easy to introduce by hand.
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

var HUB_BASE     = env('AIRTABLE_HUB_BASE_ID') || 'appGG8camPZ04Tsz6';
var CLIENTS_TBL  = env('AIRTABLE_HUB_CLIENTS_TABLE_ID') || 'tblQTVkBcVnolpo0P';
var PACKAGES_TBL = env('AIRTABLE_HUB_PACKAGES_TABLE_ID') || 'tblEiajhPxOQmlQ69';
var SITE_URL     = (env('SITE_URL') || 'https://jointheshamrockclub.com').replace(/\/+$/, '');

var AIRTABLE_API = 'https://api.airtable.com/v0/';
var STRIPE_API = 'https://api.stripe.com/v1/';

// Fallback prices, used only if the Packages table cannot be read. These match
// the tiers on the landing page and in netlify/functions/lead.js.
var FALLBACK_PRICES = {
  'bronze': 497,
  'silver': 997,
  'gold': 1997,
  'district partner': 3197,
  'district leader': 5997,
  'district champion': 9997
};

async function airtable(token, path) {
  var res = await fetch(AIRTABLE_API + path, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok) {
    var detail = await res.text();
    throw new Error('Airtable ' + res.status + ' on ' + path + ': ' + detail.slice(0, 300));
  }
  return res.json();
}

/** Flatten a nested object into Stripe's form-encoded a[b][c]=value shape. */
function formEncode(value, prefix, out) {
  out = out || [];
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach(function (item, index) {
      formEncode(item, prefix + '[' + index + ']', out);
    });
  } else if (typeof value === 'object') {
    Object.keys(value).forEach(function (key) {
      formEncode(value[key], prefix ? prefix + '[' + key + ']' : key, out);
    });
  } else {
    out.push(encodeURIComponent(prefix) + '=' + encodeURIComponent(String(value)));
  }
  return out;
}

async function stripe(secretKey, path, payload, idempotencyKey) {
  var headers = {
    'Authorization': 'Bearer ' + secretKey,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  // Stripe replays the first response for a repeated key, so a sponsor who
  // double-clicks their link gets the same session instead of a second one.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  var res = await fetch(STRIPE_API + path, {
    method: 'POST',
    headers: headers,
    body: formEncode(payload, '').join('&')
  });
  var body = await res.json();
  if (!res.ok) {
    var message = (body && body.error && body.error.message) || ('Stripe ' + res.status);
    throw new Error(message);
  }
  return body;
}

function html(statusCode, title, message) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex">' +
      '<title>' + title + ' \u2014 The Shamrock Club</title>' +
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;' +
      'justify-content:center;padding:32px 16px;background:#f7f8fc;color:#17142b;' +
      'font:16px/1.65 "DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
      '.card{width:100%;max-width:560px;background:#fff;border:1px solid #e4e5ee;' +
      'border-radius:24px;box-shadow:0 24px 70px rgba(17,11,68,.14);padding:40px 34px;' +
      'text-align:center}' +
      'h1{font-family:"Oswald",sans-serif;text-transform:uppercase;font-weight:700;' +
      'font-size:clamp(24px,5vw,32px);line-height:1.15;margin:0 0 14px;color:#17115a}' +
      'p{margin:0 0 18px;color:#676879}' +
      'a{display:inline-block;background:#e10600;color:#fff;text-decoration:none;' +
      'font-family:"Oswald",sans-serif;text-transform:uppercase;letter-spacing:.08em;' +
      'font-size:15px;padding:13px 28px;border-radius:999px}' +
      '</style></head><body><div class="card"><h1>' + title + '</h1>' +
      '<p>' + message + '</p>' +
      '<p><a href="' + SITE_URL + '/">Back to The Shamrock Club</a></p>' +
      '</div></body></html>'
  };
}

/** Price for a Client, read from the package linked to them. */
async function priceForClient(token, client) {
  var links = client.fields && client.fields['Selected Package'];
  var packageId = Array.isArray(links) && links.length ? links[0] : null;
  if (!packageId) return null;

  var pkg = await airtable(token, HUB_BASE + '/' + PACKAGES_TBL + '/' + packageId);
  var name = (pkg.fields && pkg.fields['Package Name']) || 'Sponsorship';
  var price = pkg.fields && pkg.fields['Price (USD)'];

  if (typeof price !== 'number' || price <= 0) {
    price = FALLBACK_PRICES[String(name).trim().toLowerCase()];
  }
  if (typeof price !== 'number' || price <= 0) return null;

  return {
    id: packageId,
    name: String(name).trim(),
    price: price,
    description: (pkg.fields && pkg.fields['Package Description']) || ''
  };
}

/**
 * A key that is stable for one sponsor and price within the same hour. Long
 * enough to swallow a double-click, short enough that a sponsor returning the
 * next day is never handed a session that has since expired.
 */
function idempotencyKey(clientId, price) {
  var hourBucket = new Date().toISOString().slice(0, 13);
  return 'checkout:' + clientId + ':' + price + ':' + hourBucket;
}

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var clientId = String(params.client || '').trim();
  var wantsJson = String(params.format || '').toLowerCase() === 'json';

  if (!/^rec[A-Za-z0-9]{14}$/.test(clientId)) {
    return html(400, 'That payment link is not valid',
      'Please use the link we emailed you, or reply to that email and we will send a fresh one.');
  }

  var secretKey = env('STRIPE_SECRET_KEY');
  var token = env('AIRTABLE_TOKEN');
  if (!secretKey || !token) {
    console.error('Stripe checkout is missing configuration:',
      'STRIPE_SECRET_KEY set =', Boolean(secretKey), '; AIRTABLE_TOKEN set =', Boolean(token));
    return html(503, 'Payments are not switched on yet',
      'Please email us and we will take payment another way.');
  }

  var client;
  try {
    client = await airtable(token, HUB_BASE + '/' + CLIENTS_TBL + '/' + clientId);
  } catch (err) {
    console.error('Could not load client ' + clientId + ': ' + err.message);
    return html(404, 'We could not find that sponsorship',
      'Please reply to the email we sent you and we will sort it out.');
  }

  var fields = client.fields || {};
  if (fields['Payment Status'] === 'Paid') {
    return html(200, 'This sponsorship is already paid',
      'Thank you — nothing further is owed. We are already working on your deliverables.');
  }

  var pkg;
  try {
    pkg = await priceForClient(token, client);
  } catch (err) {
    console.error('Could not read the package for ' + clientId + ': ' + err.message);
    pkg = null;
  }
  if (!pkg) {
    console.error('No priced package linked to client ' + clientId);
    return html(409, 'We still need to confirm your tier',
      'Your sponsorship level has not been finalised yet. We will send your payment link as soon as it is.');
  }

  var businessName = fields['Business Name'] || fields['Company Name'] || 'Sponsor';
  var session;
  try {
    session = await stripe(secretKey, 'checkout/sessions', {
      mode: 'payment',
      client_reference_id: clientId,
      success_url: SITE_URL + '/payment-complete.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: SITE_URL + '/',
      billing_address_collection: 'required',
      customer_email: fields['Contact Email'] || undefined,
      // Sponsors file these against their own books, so Stripe issues a proper
      // receipt rather than us having to produce one by hand.
      invoice_creation: { enabled: true },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(pkg.price * 100),
          product_data: {
            name: 'The Shamrock Club — ' + pkg.name + ' Sponsorship',
            description: ('Annual sponsorship for ' + businessName +
              (fields['Sponsored School(s)'] ? ', supporting ' + fields['Sponsored School(s)'] : '') + '.').slice(0, 500)
          }
        }
      }],
      metadata: {
        airtable_client_id: clientId,
        package: pkg.name,
        business: String(businessName).slice(0, 200)
      },
      // Copied onto the PaymentIntent so refunds can be traced back to the
      // same Client record without looking up the session.
      payment_intent_data: {
        description: pkg.name + ' sponsorship — ' + businessName,
        metadata: { airtable_client_id: clientId, package: pkg.name }
      }
    }, idempotencyKey(clientId, pkg.price));
  } catch (err) {
    console.error('Stripe rejected the checkout session for ' + clientId + ': ' + err.message);
    return html(502, 'We could not start the payment',
      'Please try again in a moment, or reply to our email and we will help.');
  }

  if (wantsJson) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: true, url: session.url, id: session.id })
    };
  }

  return {
    statusCode: 303,
    headers: { Location: session.url, 'Cache-Control': 'no-store' },
    body: ''
  };
};

// Exported for local testing.
exports._internals = { env: env, formEncode: formEncode, priceForClient: priceForClient, idempotencyKey: idempotencyKey };
