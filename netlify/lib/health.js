'use strict';

/**
 * One row per scheduled function in the Automation Health table.
 *
 * The point is to tell "the schedule is not firing" apart from "the schedule
 * fired and had nothing to do". Both look like an empty field in Airtable, and
 * that ambiguity has cost days on this project. A heartbeat removes it: the
 * jobs work every third 30-minute tick, so a healthy row is at most ~90
 * minutes old, and anything older means nothing is running.
 *
 * Shared rather than copied. Two functions writing to the same table with two
 * implementations drift, and the one that drifts is the one nobody is reading
 * at the time.
 *
 * Required environment variable:
 *   AIRTABLE_TOKEN   needs write access to the Lead Follow-Up Funnel base
 * Optional (default to the current IDs):
 *   AIRTABLE_BASE_ID, AIRTABLE_HEALTH_TABLE_ID
 */

var API = 'https://api.airtable.com/v0/';

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

/**
 * Write this function's heartbeat.
 *
 * `lines` is whatever the caller wants the next person to read: counts first,
 * then a line per thing that could not be done and why. The reason matters
 * more than the count - a bare "failed: 1" sends someone to logs they cannot
 * reach, which is the situation this table exists to end.
 *
 * Best-effort by design: health reporting must never break the thing it
 * reports on, so every failure here is swallowed and logged.
 */
async function report(token, functionName, lines) {
  if (!token) return;
  try {
    var now = new Date().toISOString();
    var summary = ['Ran at ' + now + ' UTC.'].concat(lines || []);

    // One upsert rather than a lookup plus a write. This runs on every working
    // tick of every scheduled job, so a spare call here is thousands of wasted
    // Airtable requests a month, against a cap that is the binding constraint
    // on how often these can run at all.
    var res = await fetch(API + (env('AIRTABLE_BASE_ID') || 'appiaYFwD340oK6uQ') + '/' +
                          (env('AIRTABLE_HEALTH_TABLE_ID') || 'tblJSPfLUVnwEObui'), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ['Function'] },
        records: [{
          fields: {
            'Function': functionName,
            'Last Run At': now,
            'Last Result': summary.join('\n').slice(0, 5000)
          }
        }]
      })
    });
    if (!res.ok) {
      var detail = await res.text();
      throw new Error('Airtable ' + res.status + ': ' + detail.slice(0, 200));
    }
  } catch (err) {
    console.error('Could not write Automation Health for ' + functionName + ': ' + err.message);
  }
}

module.exports = { report: report };
