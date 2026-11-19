'use strict';

/**
 * /pay must refuse anyone who does not owe money yet.
 *
 * A founding partner's Client record exists from the day they are approved,
 * more than a year before their first invoice. It has a package, and its
 * payment URL is derivable from its record id. Nothing structural stops that
 * URL taking their money during the free period, and a refund does not undo
 * having asked a volunteer-run sponsor for money they did not owe.
 *
 * Airtable's payment-link column blanks for these clients, but a blank column
 * is a display. This is the lock.
 */

const { freshRequire, stubStripe, clearRepoModules } = require('./lib/harness');

const CLIENTS = 'tblQTVkBcVnolpo0P';
const PACKAGES = 'tblEiajhPxOQmlQ69';
const F = {
  name: 'fldZfuAoYspajx8VN',
  email: 'fldVr1R7NSXFjz3Qp',
  pkg: 'fldMAkim7WYoVm5Y5',
  payStatus: 'fldneS99GflXEcrJK',
  phase: 'fld68iwxK6zZJ03lB'
};

const SILVER = {
  fldaDjNlqMpN6ZVvV: 'Silver',
  fldi9OSj5TetkR5y6: true,
  fldEcExhr6RGvIaSE: 'price_annual_test',
  fldcBcCGrZDnxkzPt: 'price_monthly_test'
};

module.exports = async function (t) {
  process.env.AIRTABLE_TOKEN = 'patTEST';
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_real';
  process.env.SITE_URL = 'https://jointheshamrockclub.com';

  const stripe = stubStripe();
  const realFetch = global.fetch;

  /** Load pay.js fresh against one client record, with Stripe counted. */
  function load(clientFields) {
    stripe.checkouts.length = 0;
    global.fetch = async url => {
      const u = String(url);
      if (u.includes(CLIENTS)) return { ok: true, status: 200, json: async () => ({ id: 'recX', fields: clientFields }) };
      if (u.includes(PACKAGES)) return { ok: true, status: 200, json: async () => ({ id: 'recPKG', fields: SILVER }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    clearRepoModules();
    return freshRequire('netlify/functions/pay.js');
  }
  const call = (mod, query) =>
    mod.handler({ queryStringParameters: Object.assign({ client: 'recDjfis8vyu0ak3x' }, query) });

  try {
    // --- a founding partner inside the free period
    const founder = {
      [F.name]: 'A+ Bookkeeping Solutions', [F.email]: 'a@b.com', [F.pkg]: ['recPKG'],
      [F.payStatus]: 'Not yet billed', [F.phase]: 'Founding partner — free year'
    };

    let res = await call(load(founder));
    t('Stripe is never contacted for a founder', stripe.checkouts.length === 0, stripe.checkouts.length);
    t('they are not redirected to checkout', !/checkout\.stripe\.com/.test(res.body || ''),
      (res.body || '').slice(0, 160));
    t('they are told there is nothing to pay', /nothing to pay/i.test(res.body || ''),
      (res.body || '').slice(0, 220));
    t('the reply says when billing starts', /April 2027/.test(res.body || ''));
    t('it reads as information, not an error', res.statusCode === 200, res.statusCode);

    // --- naming a plan must not step around it
    for (const plan of ['annual', 'monthly']) {
      res = await call(load(founder), { plan });
      t('plan=' + plan + ' cannot bypass the guard',
        stripe.checkouts.length === 0 && /nothing to pay/i.test(res.body || ''), stripe.checkouts.length);
    }

    // --- either signal alone is enough; a half-edited record stays shut
    res = await call(load(Object.assign({}, founder, { [F.payStatus]: 'Awaiting payment' })));
    t('the free-year phase alone still blocks',
      stripe.checkouts.length === 0 && /nothing to pay/i.test(res.body || ''), stripe.checkouts.length);
    res = await call(load(Object.assign({}, founder, { [F.phase]: '' })));
    t('"Not yet billed" alone still blocks',
      stripe.checkouts.length === 0 && /nothing to pay/i.test(res.body || ''), stripe.checkouts.length);

    // --- a sponsor who genuinely owes money must be unaffected
    const billable = {
      [F.name]: 'JM PAINTING', [F.email]: 'j@m.com', [F.pkg]: ['recPKG'], [F.payStatus]: 'Awaiting payment'
    };
    res = await call(load(billable), { plan: 'annual' });
    t('a billable sponsor reaches Stripe', stripe.checkouts.length === 1, stripe.checkouts.length);
    t('and is sent to the real checkout',
      /checkout\.stripe\.com/.test((res.headers && res.headers.Location) || res.body || ''),
      { status: res.statusCode, location: res.headers && res.headers.Location });
    t('the session carries the annual price',
      stripe.checkouts[0] && JSON.stringify(stripe.checkouts[0]).includes('price_annual_test'));

    res = await call(load(billable), { plan: 'monthly' });
    t('monthly uses the monthly price',
      stripe.checkouts[0] && JSON.stringify(stripe.checkouts[0]).includes('price_monthly_test'));

    res = await call(load(billable));
    t('with no plan chosen they get the chooser, not a charge',
      stripe.checkouts.length === 0 && /month/i.test(res.body || ''), (res.body || '').slice(0, 160));

    // --- already paid keeps its own message rather than the founder one
    res = await call(load(Object.assign({}, billable, { [F.payStatus]: 'Paid' })));
    t('a paid sponsor is told they are paid up',
      /already been paid/i.test(res.body || '') && stripe.checkouts.length === 0,
      (res.body || '').slice(0, 160));

    // --- a malformed link must not reach Airtable or Stripe
    const mod = load(billable);
    res = await mod.handler({ queryStringParameters: { client: 'not-a-record-id' } });
    t('a malformed client id is refused', res.statusCode === 400, res.statusCode);
    t('and nothing is charged for it', stripe.checkouts.length === 0, stripe.checkouts.length);
  } finally {
    stripe.restore();
    global.fetch = realFetch;
  }
};
