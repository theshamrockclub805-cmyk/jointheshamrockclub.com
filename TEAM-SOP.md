# Shamrock Club — how to run the system

A task-by-task guide. Find what you're doing, follow the steps.

You do not need to understand the whole system to use it. But read **The one rule**
below before you touch anything.

---

## The one rule

**Never mark a Client "Paid" until the money is actually in the bank.**

Marking Paid is the trigger that generates every deliverable and starts the
sponsorship clock. Doing it early creates work nobody owes yet, and the dates
will all be wrong. There is no clean undo.

---

## The three bases

| Base | What lives there | You'll use it for |
| --- | --- | --- |
| **Lead Follow-Up Funnel** | Inquiries and applications from the website | Reviewing and approving new sponsors |
| **Business Sales Funnel Manager** | Outbound prospects, schools, slots | Checking school availability; chasing leads |
| **Client Deliverables Hub** | Paid sponsors and their work | Everything after payment |

They don't talk to each other directly. A scheduled job moves approved
applicants across every 15 minutes. That's why some things take a few minutes
to appear.

---

## Task 1 — Someone asked to talk (inquiry form)

**Where:** Lead Follow-Up Funnel → **Conversation Requests**

1. Open the new row.
2. Read **Preferred Contact Window** — the day and hour they chose, Pacific time.
   **Requested Call Time** is the next actual date that falls on.
3. Call them in that window.
4. Set **Follow-Up Status** and **Funnel Stage** to match where you got to.
5. Put what was said in the notes.

Nothing automatic happens here. It's a call list.

---

## Task 2 — An application came in

**Where:** Lead Follow-Up Funnel → **Membership Applications**

This is the important one. Work through it in order.

### Step A — Verify the business (checks 1–5)

Tick each box only when you've actually checked it. **Hover any field name in
Airtable to see exactly what to look for.**

| Check | In short |
| --- | --- |
| 1. Real and operating | Website, Google listing, real address, working phone |
| 2. Licensed or registered | Licence on file, name matches, cross-checked |
| 3. **Appropriate for a high school audience** | See below |
| 4. Contact can commit the business | They're an owner/manager, or confirmed acting for one |
| 5. Reputation clear | No pattern of complaints, licensing action, local news trouble |

**Check 3 is the one to slow down on.** This logo goes on a banner at a high
school and into a newsletter parents read. Do not tick it for alcohol, cannabis
or CBD, vape or tobacco, firearms, gambling or sports betting, adult content,
payday or title lending, bail bonds, or anything needing a 21+ age gate.

Borderline — a restaurant with a bar, a pharmacy selling tobacco — **don't
decide alone.** Leave it unticked and ask the school first.

Write what you actually looked at in **Verification Notes**, with links. If a
parent or board member ever questions a sponsor, that field is the answer.
Fill in **Verified By** and **Verified On**.

### Step B — Pin down the trade and the schools

1. **Confirmed Category** — their exact trade (Plumber, Roofer, Tire Shop…).
   Not the broad bucket they picked on the form. This is what exclusivity runs on.
2. **Assigned Schools** — which schools they're actually getting. How many
   depends on the tier:

   | Tier | Schools |
   | --- | --- |
   | Bronze / Silver / Gold | 1 |
   | District Partner | 2 |
   | District Leader | 5 |
   | District Champion | 10 (all) |

### Step C — Check availability (check 6)

For **each** school in Assigned Schools:

1. Go to Business Sales Funnel Manager → **Schools** → that school.
2. **Availability** must show open slots.
3. **Categories Taken** must **not** already list their Confirmed Category.

Exclusivity is **one sponsor per category per school**. A plumber at Rio Mesa
blocks another plumber at Rio Mesa — but not a roofer there, and not a plumber
at Pacifica.

Only then tick check 6. Never tick it because the applicant said it's fine.

### Step D — Approve

Look at **Ready to Approve**. It tells you exactly where you stand:

| It says | Do this |
| --- | --- |
| ⏳ Not ready — set Confirmed Category and Assigned Schools first | Go back to Step B |
| ⏳ Not ready — N of 6 checks outstanding | Keep working |
| ⚠️ All 6 checks done — set Verification Status to Passed | Flip the status |
| ✅ Cleared — safe to approve | Set Application Status to **Approved** |
| ⛔ Do not approve — failed verification | Reject, and say why in the notes |

Once it's Approved, **stop and wait up to 15 minutes.** The system takes over.

---

## Task 3 — What happens on its own (don't duplicate it)

Within 15 minutes of approval, without anyone doing anything:

1. The sponsor is added to **Businesses** as *Closed Won*, linked to their
   schools, holding their category. Their school's slot count drops by one.
2. A **Client** is created in the Deliverables Hub, *Onboarding / Awaiting payment*.
3. That Client gets a **Stripe Checkout Link** of their own.

**Do not create these by hand.** You'll end up with duplicates that split the
school's slots and break exclusivity.

---

## Task 4 — Get them to pay

**Where:** Client Deliverables Hub → **Clients**

### Card (Stripe)

1. Copy the **Stripe Checkout Link** from their row.
2. Paste it into your approval email.

The price is read from their package when they click, so it can never be wrong,
and the link can't be edited to pay less. When they pay, everything below
happens automatically — don't touch the record.

The link goes blank once they've paid. That's normal.

### Cash or cheque

Once the money is actually received:

1. **Payment Status** → Paid
2. **Payment Method** → Cash or Check
3. **Amount Paid** → what you actually got
4. **Payment Date** → when you got it
5. **Sponsorship Start Date** → day one of their year (every deadline counts
   from this, so get it right)

---

## Task 5 — After payment

This runs itself. Marking Paid generates:

- One **Task** per one-time deliverable in their package
- A **Deliverable Schedule** row per recurring deliverable, with cycle 1 raised

Every deadline is calculated from **Sponsorship Start Date**.

### Doing the work

**Where:** Client Deliverables Hub → **Tasks**

1. Sort by **Target Due Date**.
2. Do the work. Attach proof if there is any.
3. Set **Status** → Complete.

On a recurring deliverable, completing one cycle raises the next automatically.
You never create the next one yourself.

### Is anyone falling behind?

**Where:** Deliverable Schedule → **Delivery Health**

- *Not started* — nothing due yet
- *On track* — fine
- *Behind by N* — N cycles owed. Deal with it.

---

## Task 6 — Refunds

Refund it in the **Stripe dashboard**. Don't edit Airtable.

The Client flips to *Refunded* (or *Partially paid*) and Amount Paid adjusts by
itself, usually within seconds. Then decide what happens to their outstanding
tasks and tell the schools.

---

## Task 7 — Renewal

A **Renewal conversation** task appears about a month before their year ends.

Re-run the verification checks — a business that was clean last year may not be
now. **Verified On** tells you how old the last check is.

---

## When something looks broken

**"I approved it but nothing happened."**
Check **Ready to Approve** on the application. It almost always says ✅ only
when everything is done — if it doesn't, the system is deliberately holding the
application back. Finish the checks and it releases itself on the next run. No
need to re-approve.

**"The sponsor paid but Airtable still says Awaiting payment."**
Give it a minute. If it persists, check Stripe → Developers → Webhooks for a
failed delivery.

**"A school shows fewer slots than I expect."**
Only *Closed Won* businesses take a slot. Prospects don't. Check for a
duplicate row for the same business.

**"Two sponsors in the same trade at one school."**
That shouldn't happen. Check whether one was added to Businesses by hand
instead of through approval.

---

## Never do these

- **Never** mark Paid before the money has arrived.
- **Never** tick check 6 without opening the school and looking.
- **Never** tick check 3 for a borderline business without asking the school.
- **Never** add an approved sponsor to Businesses by hand — approval does it.
- **Never** change Sponsorship Start Date after deliverables exist. Every
  deadline shifts.
- **Never** put a Stripe key or Airtable token anywhere except Netlify's
  environment variables.
