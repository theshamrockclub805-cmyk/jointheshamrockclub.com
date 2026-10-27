'use strict';

/**
 * Deciding whether a scheduled tick is one we should actually work on.
 *
 * Netlify takes a single cron expression per function, and cron cannot express
 * an interval that does not divide the hour evenly - there is no way to write
 * "every 90 minutes". So the functions are scheduled every 30 minutes and this
 * decides which of those ticks does the work. A skipped tick returns before
 * touching Airtable, so it costs nothing against the monthly API cap.
 *
 * The decision is made on 30-minute slots rather than exact clock minutes. A
 * scheduler that fires a few minutes late still lands in its own slot and runs,
 * instead of failing an exact comparison and silently skipping a full cycle.
 * There are 48 slots in a day and 48 divides by 3, so the pattern stays
 * continuous across midnight rather than jumping.
 */

var SLOTS_PER_DAY = 48;      // 30-minute slots
var SLOTS_PER_CYCLE = 3;     // 3 x 30 minutes = every 90 minutes

/**
 * @param {Date} now
 * @param {number} offsetSlots  Shifts this function's cycle relative to others,
 *                              so two 90-minute jobs interleave instead of
 *                              firing together. One slot is 30 minutes.
 * @returns {boolean}
 */
function isWorkingTick(now, offsetSlots) {
  var date = now instanceof Date ? now : new Date();
  var minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  var slot = Math.floor(minutes / 30);
  var shifted = (slot - (offsetSlots || 0) + SLOTS_PER_DAY) % SLOTS_PER_DAY;
  return shifted % SLOTS_PER_CYCLE === 0;
}

module.exports = { isWorkingTick: isWorkingTick, SLOTS_PER_CYCLE: SLOTS_PER_CYCLE };
