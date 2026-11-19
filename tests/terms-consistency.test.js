'use strict';

/**
 * The same promise, written in several places, must say the same thing.
 *
 * A founder reads the confirmation page, signs the Membership Agreement, and
 * keeps the confirmation email. Those are three copies of one set of terms,
 * and the version stamped on their Airtable record is a fourth. A signature is
 * only evidence if it can be tied to the terms that were in force, so a stale
 * copy is not a typo - it is a different promise to whoever happened to read
 * that one.
 *
 * This has drifted twice: once on the agreement version, once on the founder
 * deadline. Both times it was invisible until someone went looking.
 */

const { readRepo, freshRequire } = require('./lib/harness');

const uniq = (text, pattern) => [...new Set([...text.matchAll(pattern)].map(m => m[0]))];

module.exports = async function (t) {
  const agreement = readRepo('membership-agreement.html');
  const confirm = readRepo('founding-partners-confirmation.html');
  const emails = readRepo('netlify/lib/emails.js');

  process.env.AIRTABLE_TOKEN = 'patTEST';
  const stamped = freshRequire('netlify/functions/founding-confirm.js')._internals.AGREEMENT_VERSION;

  // --- version: the page, its own body text, and the stamp on every record
  const banner = /Version\s+([0-9.]+)\s+&mdash;\s+effective\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(agreement) || [];
  const inBody = (/This is version ([0-9.]+)\./.exec(agreement) || [])[1];
  t('the agreement states a version and an effective date', Boolean(banner[1] && banner[2]),
    banner.slice(1).join(' / '));
  t('the banner and the body agree on the version', banner[1] === inBody, banner[1] + ' vs ' + inBody);
  t('the version stamped on signings matches the page', stamped === banner[1],
    'stamped ' + stamped + ', page ' + banner[1]);

  // --- the founder sign-up deadline, on the page they sign and in the terms
  const deadlines = uniq(agreement + confirm, /December \d{1,2}, 2026/g);
  t('one founder deadline, stated identically everywhere', deadlines.length === 1, deadlines);

  // --- the confirm-by date decides whether anyone is invoiced at all, so it
  // has to be identical in the terms, the page, and the email they keep
  const confirmBy = uniq(agreement + confirm + emails, /March \d{1,2}, 2027/g);
  t('one confirm-by date across terms, page and email', confirmBy.length === 1, confirmBy);
  for (const [name, text] of [['agreement', agreement], ['confirmation page', confirm], ['email', emails]]) {
    t('the ' + name + ' states the confirm-by date', /March 31, 2027/.test(text));
    t('the ' + name + ' states the April invoice', /April 2027/.test(text));
  }

  // --- the timeline these replaced must not survive anywhere
  for (const [name, text] of [['agreement', agreement], ['confirmation page', confirm], ['email', emails]]) {
    t('no stale "spring 2027 semester" promise in the ' + name, !/spring 2027 semester/.test(text));
  }

  // --- founder pricing is quoted to members and enforced in code
  const tiers = freshRequire('netlify/functions/founding-confirm.js')._internals.TIERS;
  t('founder Silver is $748 in code', tiers.silver.price === 748, tiers.silver);
  t('founder Gold is $1,498 in code', tiers.gold.price === 1498, tiers.gold);
  t('founder Bronze is undiscounted at $497', tiers.bronze.price === 497, tiers.bronze);
  for (const [label, amount] of [['$748', /\$748/], ['$1,498', /\$1,498/]]) {
    t('the agreement quotes ' + label, amount.test(agreement));
    t('the confirmation page quotes ' + label, amount.test(confirm));
  }

  // --- standard pricing, quoted on the public site and enforced server-side
  const packages = freshRequire('netlify/functions/lead.js')._internals.PACKAGES;
  const index = readRepo('index.html');
  for (const [key, amount] of [['bronze', 497], ['silver', 997], ['gold', 1997]]) {
    t(key + ' is $' + amount + ' server-side', packages[key].amount === amount, packages[key]);
  }
  t('District Champion covers all 11 schools', packages['district-champion'].schools === 11,
    packages['district-champion']);
  t('the homepage quotes $497', /\$497/.test(index));
  t('the homepage quotes $997', /\$997/.test(index));
  t('the homepage quotes $1,997', /\$1,997/.test(index));

  // --- membership fees are not charitable contributions, and saying otherwise
  // on a public page contradicts the signed agreement
  t('the agreement says fees are not tax-deductible',
    /not tax-deductible/.test(agreement) || /not\b[^.]{0,40}tax-deductible/.test(agreement));
  for (const page of ['index.html', 'application-form.html', 'sponsor-one-pager.html']) {
    const text = readRepo(page);
    t(page + ' never calls a membership fee a tax-deductible donation',
      !/tax-deductible donation receipt/i.test(text));
  }
};
