// GET /pay?client=recXXXXXXXXXXXXXX[&plan=annual|monthly]
//
// The link in each sponsor's approval email (Airtable "Stripe Checkout Link").
// Reads the sponsor's package from Airtable at click time, so the price can
// never drift. Packages with a monthly option show a plan chooser first;
// annual-only packages (District tiers) go straight to checkout.

const { stripe, SITE_URL: SITE, TABLES, CLIENT, PACKAGE, getRecord } = require('../lib/shared');
const COMMITMENT_MONTHS = 12;

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const clientId = q.client || '';

  if (!/^rec[A-Za-z0-9]{14}$/.test(clientId)) {
    return page(400, 'This payment link looks incomplete',
      "Please use the link from your approval email, or reply to that email and we'll send a fresh one.");
  }

  if (q.status === 'success') {
    return page(200, 'Thank you! Payment received ☘️',
      "Stripe will email your receipt shortly, and we'll follow up with a welcome email and next steps.");
  }

  let c, p, packageId;
  try {
    c = (await getRecord(TABLES.clients, clientId)).fields;
  } catch (err) {
    console.error('Client lookup failed:', err);
    return page(404, "We couldn't find that sponsorship",
      "Please reply to your approval email and we'll sort it out.");
  }

  if (c[CLIENT.paymentStatus] === 'Paid') {
    return page(200, "You're all paid up ☘️", 'This sponsorship has already been paid. Thank you!');
  }

  try {
    packageId = (c[CLIENT.selectedPackage] || [])[0];
    if (!packageId) throw new Error('No package linked');
    p = (await getRecord(TABLES.packages, packageId)).fields;
    if (!p[PACKAGE.active] || !p[PACKAGE.annualPriceId]) throw new Error('Package inactive or missing Stripe price');
  } catch (err) {
    console.error(`Package problem for ${clientId}:`, err);
    return page(409, "This sponsorship isn't ready for online payment yet",
      "Please reply to your approval email and we'll get it fixed right away.");
  }

  const offersMonthly = Boolean(p[PACKAGE.monthlyPriceId]);
  if (!q.plan && offersMonthly) return choosePlan(clientId, c, p);

  const plan = q.plan === 'monthly' && offersMonthly ? 'monthly' : 'annual';
  const metadata = { airtable_client_id: clientId, airtable_package_id: packageId, plan };
  const description = `${p[PACKAGE.name]} Sponsorship – ${c[CLIENT.businessName] || 'Sponsor'}`;
  const email = c[CLIENT.email];

  const common = {
    client_reference_id: clientId,
    line_items: [{
      price: plan === 'monthly' ? p[PACKAGE.monthlyPriceId] : p[PACKAGE.annualPriceId],
      quantity: 1,
    }],
    success_url: `${SITE}/payment-complete.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/pay?client=${clientId}`,
    metadata,
    billing_address_collection: 'required',
    ...(email ? { customer_email: email } : {}),
  };

  try {
    const session = plan === 'monthly'
      ? await stripe.checkout.sessions.create({
          ...common,
          mode: 'subscription',
          subscription_data: {
            description,
            metadata: { ...metadata, commitment_months: String(COMMITMENT_MONTHS) },
          },
          custom_text: {
            submit: {
              message: `${COMMITMENT_MONTHS} monthly payments of $${p[PACKAGE.monthlyPrice]}. ` +
                `Billing stops automatically after the final payment.`,
            },
          },
        })
      : await stripe.checkout.sessions.create({
          ...common,
          mode: 'payment',
          customer_creation: 'always',
          // Sponsors file these against their own books. (Monthly plans get
          // invoices automatically as subscriptions.)
          invoice_creation: { enabled: true },
          payment_intent_data: { description, metadata },
        });

    return { statusCode: 303, headers: { Location: session.url, 'Cache-Control': 'no-store' } };
  } catch (err) {
    console.error('Checkout creation failed:', err);
    return page(502, 'Something went wrong starting checkout',
      'Please try again in a minute. If it keeps happening, reply to your approval email.');
  }
};

// ---------- pages ----------

function choosePlan(clientId, c, p) {
  const annual = Number(p[PACKAGE.price]);
  const monthly = Number(p[PACKAGE.monthlyPrice]);
  const saves = monthly * COMMITMENT_MONTHS - annual;
  const link = (plan) => `/pay?client=${clientId}&plan=${plan}`;

  const body = `
    <p class="lead">${esc(c[CLIENT.businessName] || 'Your business')} · ${esc(p[PACKAGE.name])} Sponsorship</p>
    <div class="plans">
      <a class="plan best" href="${link('annual')}">
        <span class="tag">Best value · 2 months free</span>
        <span class="price">$${fmt(annual)}<small>/year</small></span>
        <span class="note">One payment. Save $${fmt(saves)}.</span>
        <span class="btn">Pay annually</span>
      </a>
      <a class="plan" href="${link('monthly')}">
        <span class="tag">Spread it out</span>
        <span class="price">$${fmt(monthly)}<small>/month</small></span>
        <span class="note">${COMMITMENT_MONTHS}-month commitment, then billing stops automatically.</span>
        <span class="btn">Pay monthly</span>
      </a>
    </div>`;
  return html(200, 'Choose how to pay', body);
}

function page(status, title, message) {
  return html(status, title, `<p class="lead">${esc(message)}</p>`);
}

function html(statusCode, title, inner) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · The Shamrock Club</title>
<style>
  :root { --green:#0f6b3a; --ink:#16241c; --muted:#5b6b62; --bg:#f5f8f5; --card:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg); }
  main { max-width:640px; margin:0 auto; padding:48px 20px; text-align:center; }
  .brand { color:var(--green); font-weight:700; letter-spacing:.02em; }
  h1 { font-size:1.75rem; margin:.4em 0 .3em; }
  .lead { color:var(--muted); margin:0 0 28px; }
  .plans { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
  .plan { display:flex; flex-direction:column; gap:8px; padding:24px; border-radius:14px; background:var(--card);
          border:2px solid #dfe7e1; text-decoration:none; color:inherit; transition:border-color .15s, transform .15s; }
  .plan:hover { border-color:var(--green); transform:translateY(-2px); }
  .plan.best { border-color:var(--green); }
  .tag { font-size:.8rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--green); }
  .price { font-size:2.2rem; font-weight:700; }
  .price small { font-size:1rem; font-weight:500; color:var(--muted); }
  .note { color:var(--muted); font-size:.95rem; flex:1; }
  .btn { margin-top:8px; padding:12px; border-radius:10px; background:var(--green); color:#fff; font-weight:600; }
  .plan:not(.best) .btn { background:#fff; color:var(--green); border:2px solid var(--green); }
</style></head>
<body><main><div class="brand">☘️ The Shamrock Club</div><h1>${esc(title)}</h1>${inner}</main></body></html>`,
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
