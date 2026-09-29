# Stripe setup

How sponsors pay online, and what you need to switch it on.

## How it works

Sponsorships are **not** paid for at application time — we verify the business
and confirm school availability first. Payment comes after approval:

1. An application is approved in the Lead Follow-Up Funnel.
2. `sync-approved` copies it into the Hub as a Client, `Awaiting payment`.
3. You copy that Client's **Stripe Checkout Link** into your approval email.
4. The sponsor clicks it. `pay` looks up their linked Package. Bronze, Silver
   and Gold sponsors first choose **yearly** (one payment, two months free) or
   **monthly** (12 payments, then billing stops automatically). District tiers
   go straight to yearly checkout. Prices come from the Package's Stripe Price IDs.
5. They pay. Stripe calls `stripe-webhook`, which marks the Client **Paid**.
6. Marking them Paid is what fires the deliverable automations.

The price is read from the Packages table **at the moment the sponsor clicks**,
so it can never drift from what the tier actually costs. Nothing about the
amount is carried in the link, so the link cannot be edited to pay less.

Cash and cheque still work exactly as before: set Payment Status to Paid by
hand and set Payment Method accordingly. The automations do not care how the
payment arrived.

## What you need to do once

### 1. Environment variables (Netlify > Site configuration > Environment variables)

| Name | Value | Where it comes from |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe Dashboard > Developers > API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Created in step 2 below |

`AIRTABLE_TOKEN` is already set and is reused here. The Hub base is read from
`AIRTABLE_HUB_BASE_ID` (defaulting to the Client Deliverables Hub), never from
`AIRTABLE_BASE_ID`, which on this site is the Lead Follow-Up Funnel.

Test everything with your **test mode** keys (`sk_test_...`) first. The test and
live keys have separate webhook secrets — they are not interchangeable.

**Never put a secret key in the HTML.** Anything in the page is public. Both keys
belong only in Netlify environment variables.

### 2. Create the webhook endpoint

In Stripe Dashboard > Developers > Webhooks > **Add endpoint**:

- **URL:** `https://jointheshamrockclub.com/api/stripe-webhook`
- **Events to send:**
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`
  - `charge.refunded`

(This endpoint is already registered on the live account.)

Then copy the endpoint's **signing secret** into `STRIPE_WEBHOOK_SECRET` and
redeploy so the functions pick it up.

### 3. Branding and receipts

- **Settings > Branding** — logo and brand colour. These appear on the checkout
  page and on every receipt.
- **Settings > Customer emails** — turn on receipts for successful payments.

Checkout also generates a proper Stripe invoice for each payment, which sponsors
can file against their own books. Billing address is required at checkout, so
you have it for your records.

## Testing

Use test mode keys and card `4242 4242 4242 4242`, any future expiry, any CVC.

1. Create a Client in the Hub with a Package linked and Payment Status
   `Awaiting payment`.
2. Open its **Stripe Checkout Link**. Confirm the amount matches the tier.
3. Pay with the test card.
4. The Client should flip to `Paid` / `Stripe`, with Amount Paid, Payment Date,
   Sponsorship Start Date and Stripe Payment ID filled in — and their
   deliverables should appear in Tasks.

If nothing happens, check Stripe Dashboard > Webhooks > your endpoint. Failed
deliveries are listed there with the response our function returned.

## Monthly plans

- Bronze $49, Silver $99, Gold $199 per month, 12 payments. Paying yearly
  ($497 / $997 / $1,997) works out to two months free.
- Prices live in Stripe; each Package row stores its `Stripe Annual Price ID`
  and `Stripe Monthly Price ID`. Stripe prices cannot be edited: to change one,
  create a new Price in Stripe and paste its ID into the Package row. Leave
  `Stripe Monthly Price ID` blank to make a package yearly-only.
- The first monthly payment marks the Client **Paid** (so deliverables start)
  and sets **Monthly Billing Status** to Active. Every payment recounts
  **Monthly Payments Made** from Stripe, so it can never double-count.
- A failed card sets **Monthly Billing Status** to Past Due; Stripe retries
  automatically. Payment Status is deliberately left at Paid, because flipping
  it off and back on would re-run the deliverable automations and duplicate tasks.
- The subscription ends itself after 12 payments (Completed). If it ends early,
  the Client becomes **Canceled** and drops off the public directory.
- Hold the banner and plaque for monthly sponsors until Monthly Payments Made
  reaches 2.
- Refunds of monthly payments are not synced automatically; adjust by hand.

## Notes on how it behaves

- **Payment is confirmed by the webhook, never by the success page.** A sponsor
  who closes the tab early is still recorded as paid.
- **Stripe retries until it gets a 200.** Repeat deliveries of the same payment
  are ignored, so a Client cannot be double-charged or double-recorded.
- **A sponsor who already paid** gets an "already paid" page instead of a second
  checkout, so an old link in an old email cannot charge them twice.
- **Refunds** flip the Client to `Refunded` (or `Partially paid`) and adjust
  Amount Paid. They are matched by the Stripe Payment ID we stored, so they work
  even for a refund issued from the Stripe Dashboard.
- **Links expire** after 24 hours, per Stripe's default. The Checkout Link in
  Airtable always creates a fresh session, so simply re-sending it works.
- **Deliverable deadlines** count from Sponsorship Start Date, which is set on
  first payment and never moved afterwards.
