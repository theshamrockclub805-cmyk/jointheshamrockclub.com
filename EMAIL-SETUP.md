# Automatic emails

Three of the four planned emails are live. The quarterly proof-of-delivery
recap is not built yet — see the end.

## What sends, and when

| Email | Fires | Guard |
| --- | --- | --- |
| **We got your application** | Instantly on form submit | — |
| **You are approved** (carries the payment link) | Within 15 min of Application Status → Approved | Approval Email Sent At |
| **Welcome to the Club** | Within 15 min of Payment Status → Paid | Welcome Email Sent At |

The welcome watches Airtable rather than Stripe, so a sponsor who pays by
**cash or cheque** is welcomed exactly like one who paid by card.

Each guard field is checked before sending and only stamped **after** the send
succeeds. So nobody is ever asked to pay twice, and a failed send retries on
the next run instead of going quiet. To deliberately re-send, clear the guard
field.

## Turning it on

Nothing sends until these exist. Until then every attempt is logged and
skipped — forms, approvals and payments all carry on working.

### 1. Create a Resend account

At [resend.com](https://resend.com) — the free tier covers 3,000 emails a
month, which is far more than this needs.

### 2. Verify your domain

**Domains → Add Domain →** `jointheshamrockclub.com`, then add the DNS records
it gives you. This is the step that decides whether your email lands in the
inbox or in spam, so don't skip it and don't send from a gmail.com address.

### 3. Add three variables in Netlify

Site configuration → Environment variables:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | `re_...` from Resend → API Keys |
| `MAIL_FROM` | `The Shamrock Club <hello@jointheshamrockclub.com>` |
| `MAIL_REPLY_TO` | *(optional)* where replies should land |
| `MAIL_BCC` | *(optional)* a team address that silently copies every email |

`MAIL_BCC` is worth setting at first — you see exactly what sponsors receive
without asking them.

Then **Deploys → Trigger deploy**. Environment variables only apply to new builds.

### 4. Test it

Submit the application form with your own address. The confirmation should
arrive in under a minute, and **Confirmation Email Sent At** should fill in on
the application.

## Changing the wording

All copy lives in `netlify/lib/emails.js`, one function per email, separate
from the logic that decides when to send. Editing wording cannot break timing.

The layout and sending live in `netlify/lib/mailer.js`. Swapping Resend for
another provider is a change to one function there.

## Notes

- Every email is sent as both HTML and plain text.
- Business names come from a public form, so they are escaped, never treated
  as markup. Links are restricted to http and https.
- An email failure never breaks what triggered it. A sponsor who submits the
  form has still applied; a payment is still a payment.

## Not built yet: the quarterly recap

The fourth email is the one that most affects renewals. You sell visibility —
if a sponsor cannot see what they got, renewal is a cold ask. A quarterly
"here is what we did for you" (posts published, banner photo, newsletter
mentions, radio spots) turns it into a formality.

The data already exists in Tasks: completed deliverables, with dates, per
client. What is missing is the job that groups them per sponsor per quarter
and writes them into an email. It needs a decision first — calendar quarters
for everyone, or each sponsor's own three-month anniversaries.
