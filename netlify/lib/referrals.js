'use strict';

/**
 * Who earns a referral, and how much.
 *
 * One rate, on the FIRST YEAR's sponsorship fee only:
 *
 *   District employee  15%  to their school program, never to them personally
 *   Individual          -   recorded for review, promised nothing
 *
 * The 15% cannot be taken as personal money. It is program funding: a teacher
 * who signs a business up earns their band or their team money, which is the
 * whole point of the scheme. A district employee taking personal commission
 * for steering sponsors toward their own district is a different thing
 * entirely, and not something this code can produce.
 *
 * An individual referral is captured but carries NO automatic payout and no
 * promise of one. The form thanks them and takes their details; what happens
 * next is decided case by case. This is deliberate: paying individuals is
 * compensation rather than program funding, which brings W-9s and a $600
 * 1099 threshold with it, and none of that is worth taking on for a referral
 * scheme whose point is funding school programs. Stamping the type without a
 * rate keeps those referrals visible and reviewable without owing anybody
 * anything the moment a form is submitted.
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

/**
 * Referrer Type -> share of the first-year fee.
 *
 * A type with no entry here earns nothing automatically. That is not an
 * oversight for 'Individual': it is the whole mechanism by which an individual
 * referral is recorded without becoming a debt.
 */
var RATES = {
  'District employee': 0.15
};

/**
 * The two "how did you hear" answers that name a specific person worth
 * recording as a referrer. Only the first of them earns anything.
 *
 * Everything else - Instagram, a local event, another business, "Other" - takes
 * a name so the right person can be thanked, and is not typed at all. That is
 * on purpose: those write-ins routinely hold "@handle", "their newsletter" or
 * "saw a flyer", which are not people and must never look like payees.
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

/** True for a type that is recorded but earns nothing automatically. */
function isRecordOnly(type) {
  var name = selectName(type);
  return Boolean(name) && !RATES[name];
}

module.exports = {
  RATES: RATES,
  isRecordOnly: isRecordOnly,
  TYPE_BY_SOURCE: TYPE_BY_SOURCE,
  typeFor: typeFor,
  rateFor: rateFor,
  asPercent: asPercent,
  DISTRICT: 'District employee',
  INDIVIDUAL: 'Individual'
};
