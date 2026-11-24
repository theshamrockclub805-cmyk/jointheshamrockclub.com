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
  t('District Champion covers 10 schools', packages['district-champion'].schools === 10,
    packages['district-champion']);
  // The network is bigger than the biggest package, so no tier may claim to
  // cover "all" of it. That claim was true at 11 schools and is not any more.
  // HTML comments are stripped first: this is about what a sponsor reads, and
  // a note to the next developer is not a promise to anybody.
  const visible = page => readRepo(page).replace(/<!--[\s\S]*?-->/g, '');
  for (const page of ['index.html', 'application-form.html', 'sponsor-one-pager.html']) {
    const claim = visible(page).match(/all \d+ schools|all of our schools|every school\b/i);
    t(page + ' never claims a tier covers every school', !claim, claim && claim[0]);
  }
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

  // --- the referral rates a referrer is PROMISED on the form, against the
  // ones that actually accrue. The form is a static page and cannot read the
  // lib, so nothing but this holds the two together: a rate changed in one
  // place and not the other is a promise the payout quietly breaks.
  // --- the school list lives in four places: two dropdowns on the form, the
  // printed one-pager and the canvassing grid. It has drifted before, and a
  // school missing from one of them is a school nobody can be signed up for
  // with no error anywhere. These hold them together.
  const form = readRepo('application-form.html');
  const optionsIn = id => {
    const block = form.slice(form.indexOf('id="' + id + '"'));
    return (block.slice(0, block.indexOf('</select>')).match(/<option[^>]*>([^<]*)<\/option>/g) || [])
      .map(o => o.replace(/<[^>]*>/g, '').trim())
      .map(o => o.replace(/ &mdash; temporarily unavailable$/, ''))
      .filter(o => o && !/^Select one$|^No preference/.test(o));
  };
  const referrerSchools = optionsIn('referrer-school');
  const sponsorSchools = optionsIn('school');
  t('the two dropdowns offer the same schools',
    referrerSchools.join('|') === sponsorSchools.join('|'),
    { referrer: referrerSchools, sponsor: sponsorSchools });
  t('both are in alphabetical order, so a new one is added in the right place',
    referrerSchools.join('|') === [...referrerSchools].sort().join('|'), referrerSchools);

  // The one-pager and the grid use short names, so these compare counts and
  // check each short name is the start of a real school rather than matching
  // the strings exactly.
  const onePager = readRepo('sponsor-one-pager.html');
  const listed = (onePager.match(/<strong>Schools in the network:<\/strong>([\s\S]*?)<\/p>/) || ['', ''])[1]
    .replace(/\s+/g, ' ').split('&middot;').map(x => x.trim()).filter(Boolean);
  t('the one-pager lists every school', listed.length === referrerSchools.length,
    { onePager: listed.length, schools: referrerSchools.length, listed });
  t('and every name on it is a real school',
    listed.every(short => referrerSchools.some(full => full.startsWith(short))),
    listed.filter(short => !referrerSchools.some(full => full.startsWith(short))));

  const plan = readRepo('marketing-plan.html');
  const columns = (plan.match(/<th class="sch">/g) || []).length;
  t('the canvassing grid has a column per school', columns === referrerSchools.length,
    { columns, schools: referrerSchools.length });
  const sums = plan.match(/(\d+) sellable categories &times; (\d+) schools = (\d+) single-school slots/);
  t('the grid states the right school count', sums && Number(sums[2]) === referrerSchools.length,
    sums && sums[0]);
  t('and its slot arithmetic is right',
    sums && Number(sums[1]) * Number(sums[2]) === Number(sums[3]), sums && sums[0]);
  t('the grid has a cell for every category and school',
    (plan.match(/<td class="cell">/g) || []).length === Number(sums[1]) * Number(sums[2]),
    (plan.match(/<td class="cell">/g) || []).length);

  // --- the nonprofit disclosure. Saying "501(c)(3)" prominently and NOT
  // saying what that does to deductibility is the inference people make on
  // their own, and it is the one the signed agreement contradicts. Wherever
  // the page claims the status, it has to carry the caveat too.
  const EIN = '61-2052400';
  for (const page of ['index.html', 'sponsor-one-pager.html', 'membership-agreement.html']) {
    const text = readRepo(page);
    t(page + ' states the 501(c)(3) status', /501\(c\)\(3\)/.test(text), page);
    t(page + ' states the EIN ' + EIN, text.includes(EIN), page);
    t(page + ' says a fee is not a deductible charitable contribution',
      /not\b[^.]{0,60}(tax-deductible|deductible)/i.test(text), page);
  }
  t('no page quotes a different EIN',
    ['index.html', 'sponsor-one-pager.html', 'membership-agreement.html', 'privacy.html']
      .every(p => (readRepo(p).match(/\b\d{2}-\d{7}\b/g) || []).every(n => n === EIN)));
  t('the landing page points at the privacy policy',
    /href="\/privacy\.html"/.test(readRepo('index.html')));

  // --- the network outgrew a hard count, so the page states a floor instead
  t('the landing page says "over 10" rather than a number that goes stale',
    /over 10 high schools/i.test(readRepo('index.html')), 'over 10 high schools');

  const referrals = freshRequire('netlify/lib/referrals.js');
  const district = referrals.asPercent(referrals.RATES[referrals.DISTRICT]);
  t('the form promises a district employee ' + district,
    form.includes('school program earns ' + district), district);
  t('the form quotes no rate the code does not pay',
    (form.match(/\b\d{1,2}% of your first year\b/g) || [])
      .every(phrase => phrase.startsWith(district)),
    form.match(/\b\d{1,2}% of your first year\b/g));

  // --- an individual referral is recorded and promised nothing. A percentage
  // appearing next to it on the page would be a commitment nobody agreed to
  // pay, and the form is the only place a referrer ever reads one.
  const individualBlock = (form.match(/<div id="individual-referral"[\s\S]*?<\/div>/) || [''])[0];
  t('the individual referral block exists', individualBlock.length > 0);
  t('and promises no percentage', !/\d{1,2}\s*%/.test(individualBlock), individualBlock);
  t('and promises no payment at all',
    !/\b(earn|paid|payment|reward|commission)\b/i.test(individualBlock), individualBlock);
  t('the code backs that up with no individual rate',
    referrals.isRecordOnly(referrals.INDIVIDUAL) === true);

  // --- the two labels that decide a rate must exist on the form exactly as
  // the code spells them, or the dropdown pays nobody
  for (const label of Object.keys(referrals.TYPE_BY_SOURCE)) {
    t('the form offers "' + label + '" verbatim', form.includes('<option>' + label + '</option>'));
  }
};
