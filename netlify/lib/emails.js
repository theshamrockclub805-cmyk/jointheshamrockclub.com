'use strict';

/**
 * What each email actually says.
 *
 * Separated from the sending machinery so the wording can be edited without
 * going near the logic that decides when to send. Each function takes plain
 * data and returns a message object for mailer.send().
 */

var mailer = require('./mailer');

var SITE_URL = mailer.SITE_URL;

function money(amount) {
  if (typeof amount !== 'number' || !isFinite(amount)) return '';
  return '$' + amount.toLocaleString('en-US');
}

/** First names read warmer than full names, and most people give both. */
function firstName(full) {
  var name = String(full || '').trim();
  if (!name) return 'there';
  return name.split(/\s+/)[0];
}

/**
 * 1. Someone submitted the sponsorship application.
 *
 * Its job is to stop the "did that go through?" email, and to set the
 * expectation that a real person checks the business before anyone pays.
 */
function applicationReceived(data) {
  var pkg = data.packageName && data.packageName !== 'Not sure yet'
    ? data.packageName
    : '';

  var blocks = [];
  if (data.businessName) blocks.push({ label: 'Business', value: data.businessName });
  if (pkg) blocks.push({ label: 'Sponsorship level', value: pkg });
  if (data.school) blocks.push({ label: 'School requested', value: data.school });

  return {
    to: data.email,
    subject: 'We got your Shamrock Club application',
    preheader: 'Here is what happens next, and roughly when.',
    heading: 'Thanks — we have your application',
    intro: [
      'Hi ' + firstName(data.contactName) + ', thank you for applying to back a local high school program.',
      'Nothing is owed yet. Here is exactly what happens from here:'
    ],
    blocks: [
      { bullets: [
        'We verify your business — that it is real, licensed, and a good fit for a high school audience.',
        'We confirm the school and category you asked for are still open. Categories are exclusive, so only one business per trade at each school.',
        'If everything checks out, we email you an approval with a secure payment link.'
      ] },
      { text: 'That usually takes two to three business days. We will contact you either way.' }
    ].concat(blocks.length ? [{ text: 'What you sent us:' }] : []).concat(blocks),
    footerNote: 'Questions in the meantime? Just reply to this email.'
  };
}

/**
 * 2. The application was approved. This is the one that asks for money, so it
 *    states the amount and what it buys before the button.
 */
function approvedWithPaymentLink(data) {
  var amount = money(data.amount);
  var blocks = [];
  if (data.packageName) blocks.push({ label: 'Sponsorship level', value: data.packageName });
  if (amount) blocks.push({ label: 'Annual sponsorship', value: amount });
  if (data.schools) blocks.push({ label: 'School(s)', value: data.schools });
  if (data.category) blocks.push({ label: 'Your exclusive category', value: data.category });

  return {
    to: data.email,
    subject: 'You are approved — ' + (data.businessName || 'your sponsorship') + ' and The Shamrock Club',
    preheader: amount ? 'Your ' + amount + ' sponsorship is ready to confirm.' : 'Your sponsorship is ready to confirm.',
    heading: 'You are approved',
    intro: [
      'Hi ' + firstName(data.contactName) + ', good news — your business passed our checks and the school and ' +
      'category you asked for are available.',
      'Here is what you are confirming:'
    ],
    blocks: blocks.concat([
      { text: 'Your category is held for you at that school for the sponsorship year, which means no competing ' +
              'business in the same trade can sponsor alongside you there.' }
    ]).concat(/^(bronze|silver|gold)\b/i.test(data.packageName || '') ? [
      { text: 'When you click below you can pay for the year up front (two months free), or choose 12 monthly ' +
              'payments instead. Monthly plans stop automatically after the 12th payment.' }
    ] : []),
    ctaUrl: data.paymentUrl,
    ctaLabel: 'Complete your sponsorship',
    footerNote: 'Paying by cheque or cash instead? Reply to this email and we will sort it out. ' +
                'The link above is secure and processed by Stripe; we never see your card details.'
  };
}

/**
 * 3. Payment landed. Its job is to get the assets we need before onboarding
 *    stalls, which is the usual reason a first deliverable slips.
 */
function paymentWelcome(data) {
  var blocks = [];
  if (data.packageName) blocks.push({ label: 'Sponsorship level', value: data.packageName });
  if (data.schools) blocks.push({ label: 'Supporting', value: data.schools });
  if (data.startDate) blocks.push({ label: 'Sponsorship year begins', value: data.startDate });

  return {
    to: data.email,
    subject: 'Welcome to The Shamrock Club',
    preheader: 'Two things we need from you, and what happens next.',
    heading: 'Welcome to the Club',
    intro: [
      'Hi ' + firstName(data.contactName) + ', your sponsorship is confirmed and the students thank you.',
      'Your receipt has been emailed separately by Stripe. Here is what you signed up for:'
    ],
    blocks: blocks.concat([
      { text: 'To get started we need two things from you:' },
      { bullets: [
        'Your logo — a PNG with a transparent background works best, at least 400px wide.',
        'The web address you want your listing to link to.'
      ] },
      { text: 'Reply to this email with both and we will get your listing live and your first deliverables moving. ' +
              'We will be in touch within two business days to schedule your onboarding call.' }
    ]),
    ctaUrl: SITE_URL + '/sponsors.html',
    ctaLabel: 'See our sponsors',
    footerNote: 'Keep this email — replying to it reaches the team directly.'
  };
}

/**
 * 4. A founding member confirmed their details and locked a tier. Nothing is
 *    charged, so this email's job is to put the terms they just agreed to in
 *    writing, in their inbox, where they can find them in eighteen months.
 */
function foundingPartnerConfirmed(data) {
  var price = money(data.lockedPrice);
  var blocks = [];
  if (data.businessName) blocks.push({ label: 'Business', value: data.businessName });
  if (data.tier) blocks.push({ label: 'Tier you locked in', value: data.tier });
  if (price) blocks.push({ label: 'Your locked price', value: price + ' per year' });
  if (data.signatureName) blocks.push({ label: 'Signed by', value: data.signatureName });
  if (data.signatureDate) blocks.push({ label: 'Signed on', value: data.signatureDate });

  var terms = [
    { text: 'To be clear about what happens next, and when:' },
    { bullets: [
      'Now through spring 2027: no cost. You stay in the Oxnard High School network.',
      'The 2027-28 school year: billing begins, with advance notice, ' +
        (price ? 'at your locked price of ' + price : 'at your locked price') +
        ' - even if our pricing has gone up by then. Banners and plaques go up that fall.',
      'Ongoing: Founding Partner recognition on our website and sponsor listings.'
    ] }
  ];

  // Someone asking about multiple schools has not locked a price, so promising
  // them one would be wrong. They get a conversation instead.
  if (!price) {
    terms = [
      { text: 'You asked about sponsoring more than one school, so we have not set a price yet. ' +
              'We will reach out to walk through the District Partner, Leader and Champion options ' +
              'with you. Your founding partner standing is recorded either way, and nothing is ' +
              'charged before the 2027-28 school year.' }
    ];
  }

  return {
    to: data.email,
    subject: 'Confirmed — ' + (data.businessName || 'your business') + ' as a Shamrock Founding Partner',
    preheader: 'Your founding partner terms, in writing.',
    heading: 'You are confirmed',
    intro: [
      'Hi ' + firstName(data.contactName) + ', thank you. You were with Shamrock before there was a ' +
      'fee or a structure, and your founding partner standing is now on the record.',
      'Here is what we have:'
    ],
    blocks: blocks.concat(terms),
    footerNote: 'Keep this email: it is your record of the terms you agreed to. ' +
                'Anything look wrong? Just reply and we will fix it.'
  };
}

/**
 * 5. Someone asked to be contacted rather than applying.
 *
 * Nothing automated follows a conversation request - a person has to call.
 * So this email's only job is to close the loop: confirm we have them, say
 * when to expect a human, and give them a way to reach us sooner if they
 * want. It promises nothing the automation is going to deliver, because the
 * automation is not going to deliver anything.
 */
function inquiryReceived(data) {
  var blocks = [];
  if (data.businessName) blocks.push({ label: 'Business', value: data.businessName });
  if (data.interest) blocks.push({ label: 'You asked about', value: data.interest });
  if (data.when) blocks.push({ label: 'Best time to reach you', value: data.when });

  return {
    to: data.email,
    subject: 'We got your message — The Shamrock Club',
    preheader: 'A real person will call you, not a sequence of emails.',
    heading: 'Thanks — we will be in touch',
    intro: [
      'Hi ' + firstName(data.contactName) + ', thanks for getting in touch about sponsoring a local ' +
      'high school program.',
      'Someone from our team will contact you in the window you picked, usually within one to two ' +
      'business days.'
    ],
    blocks: blocks.concat([
      { text: 'A couple of things worth knowing before we speak:' },
      { bullets: [
        'Sponsorships are exclusive by category at each school - one plumber, one salon, one ' +
          'restaurant per school - so the slot you want may be worth asking about early.',
        'Single-school sponsorships start at $497 a year, and nothing is owed until you decide to ' +
          'go ahead.'
      ] }
    ]),
    ctaUrl: SITE_URL + '/#pricing',
    ctaLabel: 'See the sponsorship levels',
    footerNote: 'Would rather talk sooner? Just reply to this email and we will call you back.'
  };
}

module.exports = {
  applicationReceived: applicationReceived,
  approvedWithPaymentLink: approvedWithPaymentLink,
  paymentWelcome: paymentWelcome,
  foundingPartnerConfirmed: foundingPartnerConfirmed,
  inquiryReceived: inquiryReceived,
  _internals: { money: money, firstName: firstName }
};
