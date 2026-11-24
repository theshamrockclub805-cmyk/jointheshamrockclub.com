'use strict';

/**
 * Who earns a referral, and how much.
 *
 *   District employee  15%  to their school PROGRAM, never to them personally
 *   Individual         10%  to the person themselves
 *
 * Real money leaves the organisation on the strength of these numbers, so
 * these cover who is owed, how much, and - the parts that matter most - that
 * nothing becomes payable before the sponsor has paid us, and that the two
 * tiers cannot be confused for one another.
 */

const { freshRequire } = require('./lib/harness');

const STAFF = 'A teacher, coach or school staff member';
const FRIEND = 'A friend or someone I know';
const DISTRICT = 'District employee';
const INDIVIDUAL = 'Individual';

/** A district-employee referral: the school is what names the payee. */
const staffApp = over => Object.assign({
  'Referrer Type': DISTRICT,
  'How Did You Hear': STAFF,
  'Referred By': 'Dana Ruiz',
  'Referrer School': 'Ventura High School',
  'Program to Credit': 'Marching Band',
  'Annual Sponsorship Amount': 997
}, over);

/** An individual referral: the person IS the payee, so the email is required. */
const individualApp = over => Object.assign({
  'Referrer Type': INDIVIDUAL,
  'How Did You Hear': FRIEND,
  'Referred By': 'Sam Lee',
  'Referrer Email': 'sam@example.com',
  'Annual Sponsorship Amount': 997
}, over);

module.exports = async function (t) {
  process.env.AIRTABLE_TOKEN = 'patTEST';
  process.env.RESEND_API_KEY = 'reTEST';
  process.env.MAIL_FROM = 'test@jointheshamrockclub.com';
  const { _internals } = freshRequire('netlify/functions/sync-approved.js');
  const referrals = freshRequire('netlify/lib/referrals.js');
  const referral = f => _internals.referralFieldsFrom(f);

  // --- the two rates, stated once and read everywhere
  t('a district employee earns 15%', referrals.RATES[DISTRICT] === 0.15, referrals.RATES);
  t('an individual earns 10%', referrals.RATES[INDIVIDUAL] === 0.10, referrals.RATES);
  // Compared by value, not identity: freshRequire hands each caller its own
  // module instance, so two copies of the same table are not the same object.
  t('the sync reads the same rates the lib defines',
    JSON.stringify(_internals.REFERRAL_RATES) === JSON.stringify(referrals.RATES),
    [_internals.REFERRAL_RATES, referrals.RATES]);
  t('the district rate is the higher of the two, because it funds a program',
    referrals.RATES[DISTRICT] > referrals.RATES[INDIVIDUAL]);

  // --- a district-employee referral
  let r = referral(staffApp());
  t('15% of the first year is owed', r['Referral Payout Due'] === 149.55, r);
  t('the credit names person, school and program',
    r['Referral Credit'] === 'Dana Ruiz (Ventura High School) — Marching Band', r['Referral Credit']);
  t('the type is recorded', r['Referrer Type'] === DISTRICT, r);
  t('the rate is recorded, so the figure can be audited later',
    r['Referral Rate'] === 0.15, r);
  t('it accrues rather than becoming payable', /^Accrued/.test(r['Referral Payout Status']),
    r['Referral Payout Status']);

  // --- an individual referral
  r = referral(individualApp());
  t('10% of the first year is owed', r['Referral Payout Due'] === 99.7, r);
  t('the credit names the person and how to reach them',
    r['Referral Credit'] === 'Sam Lee <sam@example.com>', r['Referral Credit']);
  t('the type is recorded', r['Referrer Type'] === INDIVIDUAL, r);
  t('the 10% rate is recorded', r['Referral Rate'] === 0.10, r);
  t('an individual credit names no program, because there is none',
    !/—/.test(r['Referral Credit']), r['Referral Credit']);

  // --- the rate, across every tier it can land on
  const dueAt = (make, amount) => referral(make({ 'Annual Sponsorship Amount': amount }))['Referral Payout Due'];
  t('Bronze $497 owes $74.55 / $49.70',
    dueAt(staffApp, 497) === 74.55 && dueAt(individualApp, 497) === 49.7,
    [dueAt(staffApp, 497), dueAt(individualApp, 497)]);
  t('Silver $997 owes $149.55 / $99.70',
    dueAt(staffApp, 997) === 149.55 && dueAt(individualApp, 997) === 99.7);
  t('Gold $1,997 owes $299.55 / $199.70',
    dueAt(staffApp, 1997) === 299.55 && dueAt(individualApp, 1997) === 199.7);
  t('District Champion $9,997 owes $1,499.55 / $999.70',
    dueAt(staffApp, 9997) === 1499.55 && dueAt(individualApp, 9997) === 999.7,
    [dueAt(staffApp, 9997), dueAt(individualApp, 9997)]);
  t('a founder rate of $748 owes $112.20 / $74.80',
    dueAt(staffApp, 748) === 112.2 && dueAt(individualApp, 748) === 74.8);
  t('a zero amount owes nothing, either tier',
    Object.keys(referral(staffApp({ 'Annual Sponsorship Amount': 0 }))).length === 0 &&
    Object.keys(referral(individualApp({ 'Annual Sponsorship Amount': 0 }))).length === 0);

  // --- $999.70 on a single District Champion referral clears the $600 1099
  // threshold on its own. Nothing here files a tax form, but the number has to
  // be right, because that is the one somebody reports.
  t('the biggest individual payout is over the 1099 threshold, as expected',
    dueAt(individualApp, 9997) > 600, dueAt(individualApp, 9997));

  // --- sources that earn nothing must carry no referral fields at all, rather
  // than zeroes that read like an unpaid debt
  for (const source of ['Instagram', 'Oxnard USA', 'Local event', 'TikTok',
                        'Referral from another business', 'Other']) {
    t('no payout for "' + source + '"',
      Object.keys(referral({ 'How Did You Hear': source, 'Referred By': 'someone',
                             'Referrer Email': 'a@b.com', 'Annual Sponsorship Amount': 997 })).length === 0);
  }
  t('no payout when the source is missing entirely',
    Object.keys(referral({ 'Annual Sponsorship Amount': 997 })).length === 0);

  // --- a claim nobody can be paid against is not recorded as a debt
  t('a district referral with no school is not payable',
    Object.keys(referral(staffApp({ 'Referrer School': '' }))).length === 0);
  t('an individual with no email is not payable',
    Object.keys(referral(individualApp({ 'Referrer Email': '' }))).length === 0);
  t('an individual with no name is not payable',
    Object.keys(referral(individualApp({ 'Referred By': '' }))).length === 0);
  t('an individual with only whitespace for an email is not payable',
    Object.keys(referral(individualApp({ 'Referrer Email': '   ' }))).length === 0);

  // --- the school is the payee on a district referral, so an unnamed referrer
  // is a gap to chase rather than a reason to withhold the program's money
  t('an unnamed staff referrer is flagged, not dropped',
    /Unnamed staff member/.test(referral(staffApp({ 'Referred By': '' }))['Referral Credit']));
  r = referral(staffApp({ 'Program to Credit': '' }));
  t('a missing program still accrues the money', r['Referral Payout Due'] === 149.55, r);
  t('the credit line shows the gap rather than hiding it',
    r['Referral Credit'] === 'Dana Ruiz (Ventura High School)', r['Referral Credit']);

  // --- the type is what decides the rate, not the marketing dropdown. An
  // application filed before Referrer Type existed still has to pay out.
  r = referral(staffApp({ 'Referrer Type': undefined }));
  t('a legacy staff application still earns 15%',
    r['Referral Payout Due'] === 149.55 && r['Referrer Type'] === DISTRICT, r);
  r = referral(individualApp({ 'Referrer Type': undefined }));
  t('a legacy friend application still earns 10%',
    r['Referral Payout Due'] === 99.7 && r['Referrer Type'] === INDIVIDUAL, r);
  t('a stored type beats the source it disagrees with',
    referral(staffApp({ 'Referrer Type': INDIVIDUAL, 'Referrer Email': 'd@v.org' }))['Referral Rate'] === 0.10);

  // --- the form's labels are what set the type, so they have to match
  t('the staff option maps to the district rate', referrals.typeFor(STAFF) === DISTRICT);
  t('the friend option maps to the individual rate', referrals.typeFor(FRIEND) === INDIVIDUAL);
  t('only those two options pay anything',
    Object.keys(referrals.TYPE_BY_SOURCE).length === 2, referrals.TYPE_BY_SOURCE);
  t('the form offers both paying options, worded exactly as the code expects',
    [STAFF, FRIEND].every(label =>
      require('fs').readFileSync(require('path').join(__dirname, '..', 'application-form.html'), 'utf8')
        .includes('<option>' + label + '</option>')));

  // --- Airtable returns selects as plain strings through REST and as
  // {id,name} objects through other paths. Both must work, or a payout
  // silently vanishes depending on how the record was fetched.
  r = referral(staffApp({
    'Referrer Type': { id: 'sel1', name: DISTRICT },
    'Referrer School': { id: 'sel2', name: 'Rio Mesa High School' }
  }));
  t('select values survive as {id,name} objects', r['Referral Payout Due'] === 149.55, r);
  t('an object school reaches the credit line', /Rio Mesa High School/.test(r['Referral Credit'] || ''),
    r['Referral Credit']);
  t('an object type still picks the right rate',
    referral(individualApp({ 'Referrer Type': { id: 'sel3', name: INDIVIDUAL } }))['Referral Rate'] === 0.10);

  // --- end to end: it reaches the Client record the sync creates
  for (const [label, make, due] of [['district', staffApp, 149.55], ['individual', individualApp, 99.7]]) {
    const client = _internals.clientFieldsFrom(
      { id: 'recAPP', fields: make({ 'Company Name': 'Test Co', Email: 'a@b.com', 'Selected Package': 'Silver' }) },
      { silver: 'recPKG' });
    t('the ' + label + ' Client carries the payout', client['Referral Payout Due'] === due,
      client['Referral Payout Due']);
    t('the ' + label + ' Client carries the credit line', Boolean(client['Referral Credit']));
    t('the ' + label + ' Client records the rate', client['Referral Rate'] > 0, client['Referral Rate']);
    t('the ' + label + ' Client is never created as already Paid',
      client['Referral Payout Status'] !== 'Paid', client['Referral Payout Status']);
    t('the ' + label + ' Client is never created pre-verified',
      !('Referral Verified' in client), Object.keys(client).join(','));
  }

  const plain = _internals.clientFieldsFrom(
    { id: 'recAPP2', fields: { 'Company Name': 'No Referral Co', Email: 'c@d.com',
                               'How Did You Hear': 'Instagram', 'Annual Sponsorship Amount': 997 } }, {});
  t('a sponsor nobody referred carries no referral fields',
    !('Referral Payout Due' in plain) && !('Referral Credit' in plain) &&
    !('Referral Rate' in plain), Object.keys(plain).join(','));
};
