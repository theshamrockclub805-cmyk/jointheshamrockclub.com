// Shared helpers for the /pay and /api/stripe-webhook functions.
// Airtable fields are referenced by ID, not name, so renaming a field in
// Airtable never breaks payments.

const Stripe = require('stripe');

// Same lookup the site's other functions use: case-insensitive and trimmed,
// so a stray space pasted into a Netlify variable can't break signatures.
function env(name) {
  let value = process.env[name];
  if (value === undefined) {
    const match = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    if (match) value = process.env[match];
  }
  return typeof value === 'string' ? value.trim() : value;
}

const stripe = Stripe(env('STRIPE_SECRET_KEY'));

// Client Deliverables Hub. Note: AIRTABLE_BASE_ID on this site is the Lead
// Follow-Up Funnel, so the Hub has its own variable name.
const BASE_ID = env('AIRTABLE_HUB_BASE_ID') || 'appGG8camPZ04Tsz6';
const SITE_URL = (env('SITE_URL') || 'https://jointheshamrockclub.com').replace(/\/+$/, '');

const TABLES = {
  clients: env('AIRTABLE_HUB_CLIENTS_TABLE_ID') || 'tblQTVkBcVnolpo0P',
  packages: env('AIRTABLE_HUB_PACKAGES_TABLE_ID') || 'tblEiajhPxOQmlQ69',
};

const CLIENT = {
  businessName: 'fldZfuAoYspajx8VN',
  email: 'fldVr1R7NSXFjz3Qp',
  selectedPackage: 'fldMAkim7WYoVm5Y5',
  paymentStatus: 'fldneS99GflXEcrJK',
  clientStatus: 'fldJBjJ95380HeCFS',
  paymentMethod: 'fld2g8Uh2x6KurQiF',
  amountPaid: 'flds3O7dHPm6v2E7r',
  paymentDate: 'fldnpjZCXBmvjK4LQ',
  startDate: 'fld2yf7ftYo1W9To4',
  stripePaymentId: 'fldV3YLnl5GaWBmmm',
  stripeCustomerId: 'fldyvo4w4nY4Am6FQ',
  stripeSubscriptionId: 'fld4IzRZldBeZSkDI',
  billingPlan: 'flduEXYbU591XZQkL',
  monthlyPaymentsMade: 'fldPmGolpMoMNwmx2',
  monthlyBillingStatus: 'fldccubABf1BJhJVB',
};

const PACKAGE = {
  name: 'fldaDjNlqMpN6ZVvV',
  price: 'fld31AlFcqvD8uhLS',
  monthlyPrice: 'fldBYtyWwCI1V1P0X',
  active: 'fldi9OSj5TetkR5y6',
  annualPriceId: 'fldEcExhr6RGvIaSE',
  monthlyPriceId: 'fldcBcCGrZDnxkzPt',
};

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env('AIRTABLE_TOKEN')}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function getRecord(table, id) {
  return airtable(`${table}/${id}?returnFieldsByFieldId=true`);
}

// Drops null/undefined values so a missing Stripe value never blanks a field.
function updateRecord(table, id, fields) {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)
  );
  return airtable(`${table}/${id}?returnFieldsByFieldId=true`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: clean }),
  });
}

async function findOne(table, formula) {
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: '1',
    returnFieldsByFieldId: 'true',
  });
  const { records } = await airtable(`${table}?${qs}`);
  return records[0] || null;
}

// Today's date in Oxnard, as YYYY-MM-DD (what Airtable date fields expect).
function todayPacific() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

module.exports = {
  env,
  stripe,
  SITE_URL,
  TABLES,
  CLIENT,
  PACKAGE,
  getRecord,
  updateRecord,
  findOne,
  todayPacific,
};
