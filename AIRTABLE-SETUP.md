# Sending form submissions to Airtable

Both landing-page forms file straight into the **Lead Follow-Up Funnel** Airtable base.

| Form | Airtable table |
| --- | --- |
| Request More Information (`index.html`) | Conversation Requests |
| Sponsorship Application (`application-form.html`) | Membership Applications |

## How it works

```
Visitor submits
      │
      ├──> Netlify Forms ............ keeps a copy of every submission (backstop + file uploads)
      │
      └──> /.netlify/functions/lead . creates the Airtable record
```

Two destinations on purpose. If the Airtable call ever fails — expired token,
Airtable outage, a field renamed — the lead is still sitting in Netlify Forms
rather than lost. The function never runs in the browser, so the Airtable token
is never exposed to visitors.

> **Never put an Airtable token in the HTML.** Anything in the page is public.
> The token belongs only in the Netlify environment variable below.

## One-time setup (about 5 minutes)

### 1. Create an Airtable personal access token

1. Go to <https://airtable.com/create/tokens> and click **Create token**.
2. Name it something like `Shamrock website forms`.
3. Under **Scopes**, add `data.records:write`.
4. Under **Access**, add the **Lead Follow-Up Funnel** base.
5. Create the token and copy it. Airtable shows it only once.

Use a token scoped to just this base — not a token that can reach every base in
your account.

### 2. Add the token to Netlify

In Netlify: **Site configuration → Environment variables → Add a variable**

| Key | Value |
| --- | --- |
| `AIRTABLE_TOKEN` | the token you just copied |

The name is matched case-insensitively and the value is trimmed, so
`Airtable_Token` or a value with a stray space still works. Make sure the
variable is scoped to **Functions** (or all scopes) and applies to the
**Production** deploy context, then redeploy — Netlify binds environment
variables into functions at deploy time.

That is the only required variable. These three are optional and already default
to the correct IDs — set them only if you move to a different base or table:

| Key | Default |
| --- | --- |
| `AIRTABLE_BASE_ID` | `appiaYFwD340oK6uQ` |
| `AIRTABLE_INQUIRY_TABLE_ID` | `tblOuamBk2lzzGTCb` |
| `AIRTABLE_APPLICATION_TABLE_ID` | `tbl79enOo6bpusR00` |

### 3. Deploy

Push to `main`. Netlify picks up `netlify.toml`, deploys the function, and
detects both forms. No build step is required.

### 4. Test it

Submit each form on the live site, then check that a row appeared in the matching
Airtable table. If a row does not appear, open **Netlify → Functions → lead** and
read the log — the function logs the reason Airtable rejected a record.

## What gets sent

### Conversation Requests (inquiry form)

| Airtable field | Comes from |
| --- | --- |
| Contact Name, Business Name, Email, Phone | the matching form fields |
| What would you like to discuss | the dropdown |
| Free-Text Question | "Your question" |
| Preferred Contact Window | e.g. `Thursday, 2:00-3:00 PM PT` |
| Requested Call Time | the next date that window falls on, as a real timestamp |
| Source | `Landing page - Request More Information` |
| Funnel Stage / Status / Follow-Up Status | `New` / `Unclaimed` / `Not Started` |

### Membership Applications (sponsorship application)

| Airtable field | Comes from |
| --- | --- |
| Applicant Name, Company Name, Email, Phone | the matching form fields |
| Selected Package | the tier chosen (Bronze … District Champion) |
| Annual Sponsorship Amount, Schools Included | derived from that tier |
| Business Category, City, Website, Contact Role | the matching form fields |
| Preferred School or Program, How Did You Hear, Applicant Notes | the matching form fields |
| Callback Requested | the "have someone call me" checkbox |
| Preferred Contact Window | e.g. `Tuesday, 9:00-10:00 AM PT` |
| Requested Call Time | the next date that window falls on, as a real timestamp |
| Source | `Landing page - Sponsorship Application` |
| Application Status / Funnel Stage / Review Status / Follow-Up Status | `Submitted` / `Application Received` / `Not Reviewed` / `Not Started` |

## Notes

- **Time zone.** Contact windows are Pacific. `Requested Call Time` is stored as a
  real timestamp (correct across daylight saving), and the `Preferred Contact
  Window` text keeps the visitor's wording so nothing is ambiguous.
- **The uploaded logo** is kept by Netlify Forms, not pushed into the Airtable
  attachment field. Airtable needs a public URL to attach a file; the logo can be
  downloaded from the Netlify submission and dropped onto the record. Say the word
  if you want that automated.
- **New dropdown values** (a new category, a new package) are created in Airtable
  automatically — the function sends `typecast`, so a schema change is not needed
  first.
- **Spam** is filtered two ways: a hidden honeypot field the function checks, and
  Netlify's own spam filtering on the stored submissions.

## Approved applications -> Client Deliverables Hub

Airtable cannot link or write across bases without paid Sync, so a scheduled
function does it instead. Every 15 minutes `sync-approved` looks for
applications where **Application Status = Approved** and **Pushed to
Deliverables Hub** is unticked, then:

1. creates the matching **Client** in the Hub as `Onboarding` /
   `Awaiting payment`, with the package resolved to a real link by name,
2. writes the applicant's contact, category, city, website, contact window and
   notes into CRM Notes so the first call needs no digging,
3. ticks **Pushed to Deliverables Hub** and records the new Client's record ID.

The application is only stamped *after* the Client exists, so a failure leaves
it to be retried on the next run rather than silently dropped.

Recording the payment on that Client (Payment Status -> Paid) is what triggers
deliverable generation.

### Token scope

`AIRTABLE_TOKEN` must now cover **all three** bases:

| Base | Needs | Why |
| --- | --- | --- |
| Lead Follow-Up Funnel | `data.records:read`, `data.records:write` | Where applications land, and where the sync stamps them. |
| Client Deliverables Hub | `data.records:read`, `data.records:write` | Where the Client and its deliverables are created. |
| Business Sales Funnel Manager | `data.records:read`, `data.records:write` | Where the sponsor's school slot and category exclusivity are held. |

Add the missing bases to the existing token at
<https://airtable.com/create/tokens>, or set `AIRTABLE_HUB_BASE_ID`,
`AIRTABLE_SALES_BASE_ID` and friends if you ever move bases.

Until the token reaches all three, the sync logs a clear Airtable 403 and
changes nothing — it will not create a Client whose school slot it could not
also record.
