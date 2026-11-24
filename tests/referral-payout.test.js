'use strict';

/**
 * Who earns a referral, and how much.
 *
 *   District employee  15%  to their school PROGRAM, never to them personally
 *   Individual          -   recorded for review, promised nothing
 *
 * Real money leaves the organisation on the strength of the first of those, so
 * these cover who is owed, how much, and that nothing becomes payable before
 * the sponsor has paid us.
 *
 * The second matters just as much in the other direction. An individual
 * referral must leave a record somebody can act on and NOT a debt: the moment
 * a payout amount lands on one of those rows, it joins the payable worklist
 * and somebody is owed money nobody promised them.
 */

const { freshRequire } = require('./lib/harness');

const STAFF = 'A teacher, coach or school staff member';
const FRIEND = 'A friend or someone I know';
const DISTRICT = 'District employee';
const INDIVIDUAL = 'Individual';

const MONEY_FIELDS = ['Referral Payout Due', 'Referral Rate', 'Referral Payout Status'];

/** A district-employee referral: the school is what names the payee. */
const staffApp = over => Object.assign({
  'Referrer Type': DISTRICT,
  'How Did You Hear': STAFF,
  'Referred By': 'Dana Ruiz',
  'Referrer School': 'Ventura High School',
  'Program to Credit': 'Marching Band',
  'Annual Sponsorship Amount': 997
}, over);

/** An individual referral: recorded so they can be thanked, and nothing more. */
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

  // --- exactly one rate exists. A second entry appearing in this table is how
  // an unintended payout tier would get built, so the count is pinned.
  t('a district employee earns 15%', referrals.RATES[DISTRICT] === 0.15, referrals.RATES);
  t('an individual earns no automatic rate', !referrals.RATES[INDIVIDUAL], referrals.RATES);
  t('there is exactly one paying rate', Object.keys(referrals.RATES).length === 1, referrals.RATES);
  // Compared by value, not identity: freshRequire hands each caller its own
  // module instance, so two copies of the same table are not the same object.
  t('the sync reads the same rates the lib defines',
    JSON.stringify(_internals.REFERRAL_RATES) === JSON.stringify(referrals.RATES),
    [_internals.REFERRAL_RATES, referrals.RATES]);
  t('an individual is recognised as record-only', referrals.isRecordOnly(INDIVIDUAL) === true);
  t('a district employee is not record-only', referrals.isRecordOnly(DISTRICT) === false);
  t('an unnamed type is neither', referrals.isRecordOnly('') === false);

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

  // --- an individual referral: a record, not a debt
  r = referral(individualApp());
  t('an individual is recorded', r['Referrer Type'] === INDIVIDUAL, r);
  t('with their name and how to reach them',
    r['Referral Credit'] === 'Sam Lee <sam@example.com>', r['Referral Credit']);
  t('and no payout amount, rate or status whatsoever',
    MONEY_FIELDS.every(f => !(f in r)), Object.keys(r).join(','));
  t('a blank payout is what keeps them off the payable worklist',
    r['Referral Payout Due'] === undefined, r);
  t('the email is optional - a name alone is still recorded',
    referral(individualApp({ 'Referrer Email': '' }))['Referral Credit'] === 'Sam Lee',
    referral(individualApp({ 'Referrer Email': '' })));
  t('but a nameless individual referral records nothing, having named nobody',
    Object.keys(referral(individualApp({ 'Referred By': '' }))).length === 0);
  t('the sponsorship amount is irrelevant to an individual referral',
    Object.keys(referral(individualApp({ 'Annual Sponsorship Amount': 0 }))).length === 2,
    referral(individualApp({ 'Annual Sponsorship Amount': 0 })));

  // --- the district rate, across every tier it can land on
  const due = amount => referral(staffApp({ 'Annual Sponsorship Amount': amount }))['Referral Payout Due'];
  t('Bronze $497 owes $74.55', due(497) === 74.55, due(497));
  t('Silver $997 owes $149.55', due(997) === 149.55, due(997));
  t('Gold $1,997 owes $299.55', due(1997) === 299.55, due(1997));
  t('District Champion $9,997 owes $1,499.55', due(9997) === 1499.55, due(9997));
  t('a founder rate of $748 owes $112.20', due(748) === 112.2, due(748));
  t('a zero amount owes nothing',
    Object.keys(referral(staffApp({ 'Annual Sponsorship Amount': 0 }))).length === 0);

  // --- sources that name nobody payable carry no referral fields at all,
  // rather than zeroes that read like an unpaid debt
  for (const source of ['Instagram', 'Oxnard USA', 'Local event', 'TikTok',
                        'Referral from another business', 'Other']) {
    t('nothing recorded for "' + source + '"',
      Object.keys(referral({ 'How Did You Hear': source, 'Referred By': 'someone',
                             'Referrer Email': 'a@b.com', 'Annual Sponsorship Amount': 997 })).length === 0);
  }
  t('nothing recorded when the source is missing entirely',
    Object.keys(referral({ 'Annual Sponsorship Amount': 997 })).length === 0);

  // --- a claim nobody can be paid against is not recorded as a debt
  t('a district referral with no school is not payable',
    Object.keys(referral(staffApp({ 'Referrer School': '' }))).length === 0);

  // --- the school is the payee on a district referral, so an unnamed referrer
  // is a gap to chase rather than a reason to withhold the program's money
  t('an unnamed staff referrer is flagged, not dropped',
    /Unnamed staff member/.test(referral(staffApp({ 'Referred By': '' }))['Referral Credit']));
  r = referral(staffApp({ 'Program to Credit': '' }));
  t('a missing program still accrues the money', r['Referral Payout Due'] === 149.55, r);
  t('the credit line shows the gap rather than hiding it',
    r['Referral Credit'] === 'Dana Ruiz (Ventura High School)', r['Referral Credit']);

  // --- the type is what decides the rate, not the marketing dropdown. An
  // application filed before Referrer Type existed still has to behave.
  r = referral(staffApp({ 'Referrer Type': undefined }));
  t('a legacy staff application still earns 15%',
    r['Referral Payout Due'] === 149.55 && r['Referrer Type'] === DISTRICT, r);
  r = referral(individualApp({ 'Referrer Type': undefined }));
  t('a legacy friend application is recorded and owed nothing',
    r['Referrer Type'] === INDIVIDUAL && MONEY_FIELDS.every(f => !(f in r)), r);
  t('a stored type beats the source it disagrees with',
    MONEY_FIELDS.every(f => !(f in referral(staffApp({ 'Referrer Type': INDIVIDUAL })))),
    referral(staffApp({ 'Referrer Type': INDIVIDUAL })));

  // --- the form's labels are what set the type, so they have to match
  t('the staff option maps to the district rate', referrals.typeFor(STAFF) === DISTRICT);
  t('the friend option maps to the individual type', referrals.typeFor(FRIEND) === INDIVIDUAL);
  t('only those two options are typed at all',
    Object.keys(referrals.TYPE_BY_SOURCE).length === 2, referrals.TYPE_BY_SOURCE);

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
  t('an object type is still read as record-only',
    MONEY_FIELDS.every(f =>
      !(f in referral(individualApp({ 'Referrer Type': { id: 'sel3', name: INDIVIDUAL } })))));

  // --- end to end: it reaches the Client record the sync creates
  const clientFor = make => _internals.clientFieldsFrom(
    { id: 'recAPP', fields: make({ 'Company Name': 'Test Co', Email: 'a@b.com', 'Selected Package': 'Silver' }) },
    { silver: 'recPKG' });

  let client = clientFor(staffApp);
  t('the district Client carries the payout', client['Referral Payout Due'] === 149.55,
    client['Referral Payout Due']);
  t('the district Client records the rate', client['Referral Rate'] === 0.15, client['Referral Rate']);
  t('the district Client is never created as already Paid',
    client['Referral Payout Status'] !== 'Paid', client['Referral Payout Status']);
  t('the district Client is never created pre-verified', !('Referral Verified' in client));

  client = clientFor(individualApp);
  t('the individual Client names the referrer', /Sam Lee/.test(client['Referral Credit'] || ''),
    client['Referral Credit']);
  t('the individual Client owes nothing', MONEY_FIELDS.every(f => !(f in client)),
    Object.keys(client).join(','));
  t('the individual Client still shows where they came from',
    /Sam Lee/.test(client['Referral Source'] || ''), client['Referral Source']);

  const plain = _internals.clientFieldsFrom(
    { id: 'recAPP2', fields: { 'Company Name': 'No Referral Co', Email: 'c@d.com',
                               'How Did You Hear': 'Instagram', 'Annual Sponsorship Amount': 997 } }, {});
  t('a sponsor nobody referred carries no referral fields',
    !('Referral Payout Due' in plain) && !('Referral Credit' in plain) &&
    !('Referral Rate' in plain), Object.keys(plain).join(','));
};
