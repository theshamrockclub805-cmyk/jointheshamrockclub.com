'use strict';

/**
 * Receives submissions from the two landing-page forms and creates the matching
 * record in the "Lead Follow-Up Funnel" Airtable base.
 *
 * The Airtable token lives in a Netlify environment variable and is only ever
 * read here, on the server. It is never sent to the browser.
 *
 * Required environment variables (Netlify > Site configuration > Environment variables):
 *   AIRTABLE_TOKEN    Personal access token with data.records:write on the base
 * Optional (these default to the current base/table IDs):
 *   AIRTABLE_BASE_ID, AIRTABLE_INQUIRY_TABLE_ID, AIRTABLE_APPLICATION_TABLE_ID
 */

/**
 * Read an environment variable, tolerating a different capitalisation of the
 * name (Airtable_Token, airtable_token, ...) and surrounding whitespace in the
 * value. Hosting dashboards make both mistakes easy to introduce by hand.
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

var BASE_ID = env('AIRTABLE_BASE_ID') || 'appiaYFwD340oK6uQ';
var INQUIRY_TABLE = env('AIRTABLE_INQUIRY_TABLE_ID') || 'tblOuamBk2lzzGTCb';
var APPLICATION_TABLE = env('AIRTABLE_APPLICATION_TABLE_ID') || 'tbl79enOo6bpusR00';

var TZ = 'America/Los_Angeles';
var MAX_BODY_BYTES = 64 * 1024;

var PACKAGES = {
  'bronze':            { label: 'Bronze',            amount: 497,  schools: 1 },
  'silver':            { label: 'Silver',            amount: 997,  schools: 1 },
  'gold':              { label: 'Gold',              amount: 1997, schools: 1 },
  'district-partner':  { label: 'District Partner',  amount: 3197, schools: 2 },
  'district-leader':   { label: 'District Leader',   amount: 5997, schools: 5 },
  'district-champion': { label: 'District Champion', amount: 9997, schools: 10 },
  'undecided':         { label: 'Not sure yet',      amount: null, schools: null }
};

var DAYS = {
  'any': { label: 'Any weekday', dow: null },
  '1':   { label: 'Monday',      dow: 1 },
  '2':   { label: 'Tuesday',     dow: 2 },
  '3':   { label: 'Wednesday',   dow: 3 },
  '4':   { label: 'Thursday',    dow: 4 },
  '5':   { label: 'Friday',      dow: 5 },
  '6':   { label: 'Saturday',    dow: 6 }
};

// Start hour (24h, Pacific) -> label for the one-hour block beginning at that hour.
var HOURS = {
  'any': 'Any time',
  '8':  '8:00-9:00 AM',
  '9':  '9:00-10:00 AM',
  '10': '10:00-11:00 AM',
  '11': '11:00 AM-12:00 PM',
  '12': '12:00-1:00 PM',
  '13': '1:00-2:00 PM',
  '14': '2:00-3:00 PM',
  '15': '3:00-4:00 PM',
  '16': '4:00-5:00 PM',
  '17': '5:00-6:00 PM'
};

function clean(value, maxLength) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength || 500);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Offset of America/Los_Angeles, in minutes, at a given instant. */
function zoneOffsetMinutes(date) {
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce(function (acc, part) {
    acc[part.type] = part.value;
    return acc;
  }, {});
  var asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return (asIfUTC - date.getTime()) / 60000;
}

/** Convert a Pacific wall-clock time to the matching UTC instant. */
function pacificWallClockToInstant(year, month, day, hour) {
  var naive = Date.UTC(year, month, day, hour, 0, 0);
  var offset = zoneOffsetMinutes(new Date(naive));
  var instant = naive - offset * 60000;
  // Re-resolve once so the offset is read at the corrected instant (DST edges).
  offset = zoneOffsetMinutes(new Date(instant));
  return new Date(naive - offset * 60000);
}

/** Today's date in Pacific, as {year, month (0-based), day, dow}. */
function pacificToday(now) {
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce(function (acc, part) {
    acc[part.type] = part.value;
    return acc;
  }, {});
  var dowByName = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    dow: dowByName[parts.weekday]
  };
}

/**
 * Turn the chosen day + hour block into a concrete timestamp: the next time that
 * window comes around in Pacific time. Returns null when no specific slot applies.
 */
function nextMatchingSlot(dayKey, hourKey, now) {
  var day = DAYS[dayKey];
  var hasHour = hourKey !== 'any' && HOURS[hourKey];
  if (!day || (day.dow === null && !hasHour)) return null;

  var hour = hasHour ? Number(hourKey) : 10; // sensible default when only a day is given
  var today = pacificToday(now);
  var daysAhead;

  if (day.dow === null) {
    // "Any weekday": the next weekday, skipping the weekend.
    daysAhead = 1;
    var probe = (today.dow + daysAhead) % 7;
    while (probe === 0 || probe === 6) {
      daysAhead += 1;
      probe = (today.dow + daysAhead) % 7;
    }
  } else {
    daysAhead = (day.dow - today.dow + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // always look forward, never same-day
  }

  return pacificWallClockToInstant(today.year, today.month, today.day + daysAhead, hour);
}

function contactWindowLabel(dayKey, hourKey) {
  var day = DAYS[dayKey];
  var hourLabel = HOURS[hourKey];
  if (!day && !hourLabel) return '';
  if (!day) return hourLabel + ' PT';
  if (!hourLabel || hourKey === 'any') return day.label + ', any time PT';
  return day.label + ', ' + hourLabel + ' PT';
}

function buildInquiryRecord(data, now) {
  var fields = {
    'Contact Name': clean(data.name, 200),
    'Business Name': clean(data.business, 200),
    'Email': clean(data.email, 200),
    'Source': 'Landing page - Request More Information',
    'Funnel Stage': 'New',
    'Status': 'Unclaimed',
    'Follow-Up Status': 'Not Started'
  };

  var phone = clean(data.phone, 40);
  if (phone) fields['Phone'] = phone;

  var interest = clean(data.interest, 200);
  if (interest) fields['What would you like to discuss'] = interest;

  var question = clean(data.message, 5000);
  if (question) fields['Free-Text Question'] = question;

  var windowLabel = contactWindowLabel(clean(data.bestDay, 10), clean(data.bestTime, 10));
  if (windowLabel) fields['Preferred Contact Window'] = windowLabel;

  var slot = nextMatchingSlot(clean(data.bestDay, 10), clean(data.bestTime, 10), now);
  if (slot) fields['Requested Call Time'] = slot.toISOString();

  return fields;
}

function buildApplicationRecord(data, now) {
  var pkg = PACKAGES[clean(data.tier, 40)] || PACKAGES['undecided'];

  var fields = {
    'Applicant Name': clean(data.contactName, 200),
    'Company Name': clean(data.bizName, 200),
    'Email': clean(data.email, 200),
    'Selected Package': pkg.label,
    'Source': 'Landing page - Sponsorship Application',
    'Application Status': 'Submitted',
    'Funnel Stage': 'Application Received',
    'Review Status': 'Not Reviewed',
    'Follow-Up Status': 'Not Started',
    'Callback Requested': data.callback === true || data.callback === 'true'
  };

  var optional = {
    'Phone': clean(data.phone, 40),
    'Business Category': clean(data.category, 200),
    'City': clean(data.city, 200),
    'Website': clean(data.website, 500),
    'Contact Role': clean(data.role, 200),
    'Preferred School or Program': clean(data.school, 300),
    'How Did You Hear': clean(data.heard, 200),
    'Applicant Notes': clean(data.notes, 5000)
  };
  Object.keys(optional).forEach(function (key) {
    if (optional[key]) fields[key] = optional[key];
  });

  if (pkg.amount !== null) fields['Annual Sponsorship Amount'] = pkg.amount;
  if (pkg.schools !== null) fields['Schools Included'] = pkg.schools;

  var windowLabel = contactWindowLabel(clean(data.bestDay, 10), clean(data.bestTime, 10));
  if (windowLabel) fields['Preferred Contact Window'] = windowLabel;

  return fields;
}

function json(statusCode, payload) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload)
  };
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

  var formType = clean(data.formType, 40);
  if (formType !== 'inquiry' && formType !== 'application') {
    return json(400, { ok: false, error: 'Unknown formType' });
  }

  var email = clean(data.email, 200);
  if (!isEmail(email)) {
    return json(400, { ok: false, error: 'A valid email address is required' });
  }

  var token = env('AIRTABLE_TOKEN');
  if (!token) {
    console.error('AIRTABLE_TOKEN is not set; submission was not forwarded to Airtable.');
    return json(503, { ok: false, error: 'Airtable is not configured yet' });
  }

  var now = new Date();
  var tableId = formType === 'inquiry' ? INQUIRY_TABLE : APPLICATION_TABLE;
  var fields = formType === 'inquiry'
    ? buildInquiryRecord(data, now)
    : buildApplicationRecord(data, now);

  var response;
  try {
    response = await fetch('https://api.airtable.com/v0/' + BASE_ID + '/' + tableId, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      // typecast lets Airtable create any select option it does not already have,
      // so new packages or categories do not need a schema change first.
      body: JSON.stringify({ records: [{ fields: fields }], typecast: true })
    });
  } catch (err) {
    console.error('Airtable request failed:', err.message);
    return json(502, { ok: false, error: 'Could not reach Airtable' });
  }

  if (!response.ok) {
    var detail = await response.text();
    console.error('Airtable rejected the record:', response.status, detail);
    return json(502, { ok: false, error: 'Airtable rejected the record' });
  }

  var result = await response.json();
  return json(200, { ok: true, id: result.records && result.records[0] && result.records[0].id });
};

// Exported for local testing.
exports._internals = {
  env: env,
  buildInquiryRecord: buildInquiryRecord,
  buildApplicationRecord: buildApplicationRecord,
  nextMatchingSlot: nextMatchingSlot,
  contactWindowLabel: contactWindowLabel,
  PACKAGES: PACKAGES
};
