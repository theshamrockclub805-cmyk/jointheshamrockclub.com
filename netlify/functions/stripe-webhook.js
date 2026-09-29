// POST /api/stripe-webhook
//
// Stripe calls this after payment events. It writes the result onto the
// sponsor's row in Airtable (Client Deliverables Hub > Clients).
//
// Setting Payment Status to Paid is what triggers the deliverable automations,
// so this function only ever sets Paid once per sponsor. Monthly billing
// problems go in the separate "Monthly Billing Status" field instead, so a
// failed-then-recovered card can't create duplicate tasks.
//
// Everything here is safe to run twice: Stripe re-sends events, and payment
// counts are recounted from Stripe rather than incremented.

const {
  env, stripe, TABLES, CLIENT, getRecord, updateRecord, findOne, todayPacific,
} = require('../lib/shared');

const DEFAULT_COMMITMENT = 12;
const CAN_BECOME_PAID = new Set([undefined, '', 'Awaiting payment', 'Partially paid']);

const HANDLERS = {
  'checkout.session.completed': onCheckoutCompleted,
  'checkout.session.async_payment_succeeded': onCheckoutCompleted,
  'invoice.paid': onInvoicePaid,
  'invoice.payment_failed': onInvoiceFailed,
  'customer.subscription.deleted': onSubscriptionEnded,
  'charge.refunded': onChargeRefunded,
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const headers = event.headers || {};
  const signature = headers['stripe-signature'] || headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, env('STRIPE_WEBHOOK_SECRET'));
  } catch (err) {
    console.error('Signature check failed:', err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  const handle = HANDLERS[stripeEvent.type];
  if (!handle) return { statusCode: 200, body: `Ignored ${stripeEvent.type}` };

  try {
    await handle(stripeEvent.data.object);
  } catch (err) {
    // A 500 makes Stripe retry automatically (for up to 3 days).
    console.error(`Failed on ${stripeEvent.type} (${stripeEvent.id}):`, err);
    return { statusCode: 500, body: 'Handler error; Stripe will retry' };
  }
  return { statusCode: 200, body: 'ok' };
};

// ---------- checkout ----------

async function onCheckoutCompleted(session) {
  const clientId = session.client_reference_id || session.metadata?.airtable_client_id;
  if (!clientId) return console.warn('Checkout session has no Airtable client:', session.id);

  if (session.mode === 'subscription') {
    // Record the IDs now; invoice.paid marks it Paid and counts payments.
    await updateRecord(TABLES.clients, clientId, {
      [CLIENT.billingPlan]: 'Monthly',
      [CLIENT.paymentMethod]: 'Stripe',
      [CLIENT.stripeCustomerId]: session.customer,
      [CLIENT.stripeSubscriptionId]: session.subscription,
    });
    await ensureCommitmentEnd(session.subscription);
    return;
  }

  // Bank-debit payments arrive later via checkout.session.async_payment_succeeded.
  if (session.payment_status !== 'paid') return;

  const record = await getRecord(TABLES.clients, clientId);
  const fields = {
    ...startDateIfBlank(record),
    [CLIENT.paymentMethod]: 'Stripe',
    [CLIENT.billingPlan]: 'Annual',
    [CLIENT.amountPaid]: session.amount_total / 100,
    [CLIENT.paymentDate]: todayPacific(),
    [CLIENT.stripePaymentId]: session.payment_intent,
    [CLIENT.stripeCustomerId]: session.customer,
  };
  if (CAN_BECOME_PAID.has(record.fields[CLIENT.paymentStatus])) {
    fields[CLIENT.paymentStatus] = 'Paid';
    fields[CLIENT.clientStatus] = 'Active';
  }
  await updateRecord(TABLES.clients, clientId, fields);
}

// ---------- monthly subscriptions ----------

async function onInvoicePaid(invoice) {
  const subId = subscriptionIdOf(invoice);
  if (!subId || invoice.amount_paid <= 0) return;

  const sub = await stripe.subscriptions.retrieve(subId);
  const clientId = sub.metadata?.airtable_client_id;
  if (!clientId) return console.warn('Subscription has no Airtable client:', subId);

  // Also set here in case this event arrives before checkout.session.completed.
  await ensureCommitmentEnd(sub);

  const { count, total } = await paidInvoiceTotals(subId);
  const record = await getRecord(TABLES.clients, clientId);
  const fields = {
    ...startDateIfBlank(record),
    [CLIENT.paymentMethod]: 'Stripe',
    [CLIENT.billingPlan]: 'Monthly',
    [CLIENT.stripeCustomerId]: sub.customer,
    [CLIENT.stripeSubscriptionId]: subId,
    [CLIENT.monthlyPaymentsMade]: count,
    [CLIENT.amountPaid]: total / 100,
    [CLIENT.paymentDate]: todayPacific(),
    [CLIENT.monthlyBillingStatus]: count >= commitmentOf(sub) ? 'Completed' : 'Active',
  };
  if (CAN_BECOME_PAID.has(record.fields[CLIENT.paymentStatus])) {
    fields[CLIENT.paymentStatus] = 'Paid';
    fields[CLIENT.clientStatus] = 'Active';
  }
  await updateRecord(TABLES.clients, clientId, fields);
}

async function onInvoiceFailed(invoice) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId);
  const clientId = sub.metadata?.airtable_client_id;
  if (!clientId) return;
  // Stripe retries the card automatically; a later invoice.paid sets this back to Active.
  await updateRecord(TABLES.clients, clientId, { [CLIENT.monthlyBillingStatus]: 'Past Due' });
}

async function onSubscriptionEnded(sub) {
  const clientId = sub.metadata?.airtable_client_id;
  if (!clientId) return;
  const { count } = await paidInvoiceTotals(sub.id);
  const finished = count >= commitmentOf(sub);
  await updateRecord(TABLES.clients, clientId, {
    [CLIENT.monthlyPaymentsMade]: count,
    [CLIENT.monthlyBillingStatus]: finished ? 'Completed' : 'Canceled Early',
    // Early cancellation drops them from the public directory (it requires Paid).
    ...(finished ? {} : { [CLIENT.paymentStatus]: 'Canceled' }),
  });
}

// ---------- refunds (annual payments) ----------

async function onChargeRefunded(charge) {
  if (!charge.payment_intent) return;
  const pi = String(charge.payment_intent).replace(/[^A-Za-z0-9_]/g, '');
  const record = await findOne(TABLES.clients, `{Stripe Payment ID} = '${pi}'`);
  if (!record) return console.log('Refund not matched to an annual sponsor (monthly refunds are manual):', pi);
  const fullyRefunded = charge.amount_refunded >= charge.amount;
  await updateRecord(TABLES.clients, record.id, {
    [CLIENT.paymentStatus]: fullyRefunded ? 'Refunded' : 'Partially paid',
    [CLIENT.amountPaid]: (charge.amount - charge.amount_refunded) / 100,
  });
}

// ---------- helpers ----------

// Makes the subscription end on its own after the committed number of months.
async function ensureCommitmentEnd(subOrId) {
  const sub = typeof subOrId === 'string' ? await stripe.subscriptions.retrieve(subOrId) : subOrId;
  if (sub.cancel_at || sub.status === 'canceled') return;
  const end = new Date(sub.billing_cycle_anchor * 1000);
  end.setUTCMonth(end.getUTCMonth() + commitmentOf(sub));
  await stripe.subscriptions.update(sub.id, {
    cancel_at: Math.floor(end.getTime() / 1000),
    proration_behavior: 'none',
  });
}

async function paidInvoiceTotals(subId) {
  let count = 0;
  let total = 0;
  for await (const inv of stripe.invoices.list({ subscription: subId, status: 'paid', limit: 100 })) {
    if (inv.amount_paid > 0) {
      count += 1;
      total += inv.amount_paid;
    }
  }
  return { count, total };
}

function subscriptionIdOf(invoice) {
  // Newer Stripe API versions nest this under parent; older ones put it at the top.
  return invoice.parent?.subscription_details?.subscription || invoice.subscription || null;
}

function commitmentOf(sub) {
  return parseInt(sub.metadata?.commitment_months, 10) || DEFAULT_COMMITMENT;
}

// Deliverable deadlines count from Sponsorship Start Date, so it must be set
// in the same write that flips Payment Status to Paid.
function startDateIfBlank(record) {
  return record.fields[CLIENT.startDate] ? {} : { [CLIENT.startDate]: todayPacific() };
}
