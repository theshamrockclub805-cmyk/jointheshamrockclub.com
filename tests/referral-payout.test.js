'use strict';

/**
 * School staff who sign a business up earn their school PROGRAM 15% of that
 * sponsor's first year. Real money leaves the organisation on the strength of
 * these numbers, so these cover who is owed, how much, and - the part that
 * matters most - that nothing becomes payable before the sponsor has paid us.
 */

const { freshRequire } = require('./lib/harness');

const STAFF = 'A teacher, coach or school staff member';

const application = over => Object.assign({
  'How Did You Hear': STAFF,
  'Referred By': 'Dana Ruiz',
  'Referrer School': 'Ventura High School',
  'Program to Credit': 'Marching Band',
  'Annual Sponsorship Amount': 997
}, over);

module.exports = async function (t) {
  process.env.AIRTABLE_TOKEN = 'patTEST';
  process.env.RESEND_API_KEY = 'reTEST';
  process.env.MAIL_FROM = 'test@jointheshamrockclub.com';
  const { _internals } = freshRequire('netlify/functions/sync-approved.js');
  const referral = f => _internals.referralFieldsFrom(f);

  // --- the ordinary case
  let r = referral(application());
  t('15% of the first year is owed', r['Referral Payout Due'] === 149.55, r);
  t('the credit names person, school and program',
    r['Referral Credit'] === 'Dana Ruiz (Ventura High School) — Marching Band', r['Referral Credit']);
  t('it accrues rather than becoming payable', /^Accrued/.test(r['Referral Payout Status']),
    r['Referral Payout Status']);

  // --- the rate, across every tier it can land on
  const due = amount => referral(application({ 'Annual Sponsorship Amount': amount }))['Referral Payout Due'];
  t('Bronze $497 owes $74.55', due(497) === 74.55, due(497));
  t('Silver $997 owes $149.55', due(997) === 149.55, due(997));
  t('Gold $1,997 owes $299.55', due(1997) === 299.55, due(1997));
  t('District Champion $9,997 owes $1,499.55', due(9997) === 1499.55, due(9997));
  t('a founder rate of $748 owes $112.20', due(748) === 112.2, due(748));
  t('the rate is still 15%', _internals.REFERRAL_RATE === 0.15, _internals.REFERRAL_RATE);
  t('a zero amount owes nothing',
    Object.keys(referral(application({ 'Annual Sponsorship Amount': 0 }))).length === 0);

  // --- sources that earn nothing must carry no referral fields at all, rather
  // than zeroes that read like an unpaid debt
  for (const source of ['Instagram', 'Oxnard USA', 'Local event',
                        'Referral from another business', 'A friend or someone I know']) {
    t('no payout for "' + source + '"',
      Object.keys(referral(application({ 'How Did You Hear': source }))).length === 0);
  }
  t('no payout when the source is missing entirely',
    Object.keys(referral({ 'Annual Sponsorship Amount': 997 })).length === 0);

  // --- a claim nobody can be paid against is not recorded as a debt
  t('no referrer school means no payable referral',
    Object.keys(referral(application({ 'Referrer School': '' }))).length === 0);

  // --- Airtable returns selects as plain strings through REST and as
  // {id,name} objects through other paths. Both must work, or a payout
  // silently vanishes depending on how the record was fetched.
  r = referral(application({
    'How Did You Hear': { id: 'sel1', name: STAFF },
    'Referrer School': { id: 'sel2', name: 'Rio Mesa High School' }
  }));
  t('select values survive as {id,name} objects', r['Referral Payout Due'] === 149.55, r);
  t('an object school reaches the credit line', /Rio Mesa High School/.test(r['Referral Credit'] || ''),
    r['Referral Credit']);

  // --- a missing program is still a real debt, it just cannot be sent yet
  r = referral(application({ 'Program to Credit': '' }));
  t('a missing program still accrues the money', r['Referral Payout Due'] === 149.55, r);
  t('the credit line shows the gap rather than hiding it',
    r['Referral Credit'] === 'Dana Ruiz (Ventura High School)', r['Referral Credit']);
  t('an unnamed referrer is flagged, not dropped',
    /Unnamed staff member/.test(referral(application({ 'Referred By': '' }))['Referral Credit']));

  // --- end to end: it reaches the Client record the sync creates
  const client = _internals.clientFieldsFrom(
    { id: 'recAPP', fields: application({ 'Company Name': 'Test Co', Email: 'a@b.com', 'Selected Package': 'Silver' }) },
    { silver: 'recPKG' });
  t('the Client carries the payout', client['Referral Payout Due'] === 149.55, client['Referral Payout Due']);
  t('the Client carries the credit line', Boolean(client['Referral Credit']), client['Referral Credit']);
  t('the Client is never created as already Paid', client['Referral Payout Status'] !== 'Paid',
    client['Referral Payout Status']);

  const plain = _internals.clientFieldsFrom(
    { id: 'recAPP2', fields: { 'Company Name': 'No Referral Co', Email: 'c@d.com',
                               'How Did You Hear': 'Instagram', 'Annual Sponsorship Amount': 997 } }, {});
  t('a sponsor nobody referred carries no referral fields',
    !('Referral Payout Due' in plain) && !('Referral Credit' in plain), Object.keys(plain).join(','));
};
