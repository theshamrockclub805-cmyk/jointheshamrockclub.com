'use strict';

/**
 * Who earns a referral, and how much.
 *
 * Two rates, both on the FIRST YEAR's sponsorship fee only:
 *
 *   District employee  15%  to their school program, never to them personally
 *   Individual         10%  to the person themselves
 *
 * The 15% is deliberately the higher of the two and deliberately cannot be
 * taken as personal money. It is program funding: a teacher who signs a
 * business up earns their band or their team money, which is the whole point of
 * the scheme. A district employee taking personal commission for steering
 * sponsors toward their own district is a different thing entirely, and not
 * something this code can produce.
 *
 * WHY A TYPE RATHER THAN THE "HOW DID YOU HEAR" ANSWER
 *
 * The rate used to be inferred at payout time by string-matching the marketing
 * dropdown, which made an exact label the thing standing between a teacher and
 * their money. That dropdown is edited for marketing reasons, is a single
 * select a human can re-pick by hand in Airtable, and has already drifted once
 * (Airtable still carries a stale "A school or coach" option). A label change
 * would have silently stopped paying people with no error anywhere.
 *
 * So the translation happens exactly once, at intake, and is stored as
 * Referrer Type on the record. Everything downstream reads the type. "Where did
 * you hear about us" goes back to being a marketing question.
 */

/** Referrer Type -> share of the first-year fee. */
var RATES = {
  'District employee': 0.15,
  'Individual': 0.10
};

/**
 * The only two "how did you hear" answers that mean money is owed.
 *
 * Everything else - Instagram, a local event, another business, "Other" - takes
 * a name so the right person can be thanked, and earns nothing. That is on
 * purpose: those write-ins routinely hold "@handle", "their newsletter" or
 * "saw a flyer", and a rate attached to them would accrue payable debts to
 * things that are not people.
 */
var TYPE_BY_SOURCE = {
  'A teacher, coach or school staff member': 'District employee',
  'A friend or someone I know': 'Individual'
};

/** Airtable returns a single select as a plain string or as {id, name}. */
function selectName(value) {
  return value && typeof value === 'object' ? value.name : value;
}

/**
 * The referrer type a "how did you hear" answer implies, or '' for the answers
 * that earn nothing. Used at intake to stamp the record, and as the fallback
 * for applications filed before Referrer Type existed.
 */
function typeFor(source) {
  var name = selectName(source);
  return (name && TYPE_BY_SOURCE[String(name).trim()]) || '';
}

/** The rate for a type, or 0 for a type that earns nothing. */
function rateFor(type) {
  return RATES[selectName(type)] || 0;
}

/** A rate as people say it: 0.15 -> "15%". */
function asPercent(rate) {
  return Math.round(rate * 1000) / 10 + '%';
}

module.exports = {
  RATES: RATES,
  TYPE_BY_SOURCE: TYPE_BY_SOURCE,
  typeFor: typeFor,
  rateFor: rateFor,
  asPercent: asPercent,
  DISTRICT: 'District employee',
  INDIVIDUAL: 'Individual'
};
