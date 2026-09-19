# Verifying an applicant before you approve them

Applications are not accepted on submission. Two things have to be true before
a business becomes a sponsor:

1. **The business is legitimate** — and appropriate to put in front of students.
2. **The school and category they asked for are actually available.**

Both are built, as six checks on one checklist.

## Why this exists

A sponsor's name and logo end up on a banner at a high school, in a newsletter
that goes to parents, and on social accounts students follow. The nonprofit's
standing with its schools depends on never having to explain why a particular
logo is on that banner. The cost of a slow approval is a mildly impatient
applicant. The cost of a bad one is a school relationship.

## The six checks

They live on each row of **Membership Applications**. Every checkbox has the
detail of what to look for in its field description — hover the field name in
Airtable.

| Check | What you are confirming |
| --- | --- |
| 1. Real and operating | Working website, Google listing, real street address, phone someone answers. New is fine; unreachable is not. |
| 2. Licensed or registered | Licence on file, name matches, cross-checked against CA Secretary of State or the city lookup. |
| 3. Appropriate for a high school audience | Not alcohol, cannabis/CBD, vape/tobacco, firearms, gambling, adult, payday lending, bail bonds, or anything 21+. |
| 4. Contact can commit the business | The applicant is an owner/partner/manager, or is confirmed to be acting for one. |
| 5. Reputation clear | No active pattern of complaints, licensing action, or local news trouble. |
| 6. School and category available | Every assigned school has an open slot, and this trade is not already taken there. |

Check 3 is the one to slow down on. A borderline case — a restaurant with a
bar, a pharmacy that sells tobacco — is a conversation with the school, not a
judgement call to make alone at your desk.

Check 4 is what stops an enthusiastic employee committing their employer to a
$9,997 sponsorship the owner never agreed to.

Record what you actually looked at in **Verification Notes**, with links. If an
application is ever questioned by a school, a parent, or a board member, that
field is the whole answer. Set **Verified By** and **Verified On** too.

## Reading the status

**Ready to Approve** is the one cell to look at. It reads:

| It says | It means |
| --- | --- |
| ⏳ Not ready — set Confirmed Category and Assigned Schools first | Check 6 is meaningless until you say which trade, at which schools. |
| ⏳ Not ready — N of 6 checks outstanding | Keep going. |
| ⚠️ All 6 checks done — set Verification Status to Passed | Finish the job: flip the status. |
| ✅ Cleared — safe to approve | Approve away. |
| ⛔ Do not approve — failed verification | Reject, and say why in the notes. |

Note the second row. Ticking **Verification Status = Passed** over an
unfinished checklist does not read as cleared, and it does not release the
application. A rushed review cannot be made to look like a finished one.

## It is enforced, not just advised

`netlify/functions/sync-approved.js` applies the same rule in code. An
application marked Approved whose verification has not passed **will not create
a Client**, so it never reaches the deliverables hub and never gets a payment
link. The function re-tests the status, all six checks, and the presence of
Confirmed Category and Assigned Schools, independently of the formula.

Held-back applications are not dropped silently. Each one is named in the
function log:

```
Holding back "Acme Plumbing" (recXXXX…): approved, but business verification
has not passed. Finish the checks on the application to release it.
```

They sync automatically on the next run — it polls every 15 minutes — as soon as
the checks are finished. Nothing needs re-approving.

So if an approval seems not to have gone through, check **Ready to Approve**
first. That is almost always the reason.

## How availability is checked

Exclusivity is **one sponsor per category, per school**. A plumber at Rio Mesa
blocks another plumber at Rio Mesa — not a roofer there, and not a plumber at
Pacifica.

### Why there is a second category field

The application form offers broad buckets (*Home & trade services*). Those are
too coarse to run exclusivity on: they would make a plumber block a roofer and
a painter at the same school, which is not the intent.

So the reviewer sets **Confirmed Category** on the application — the exact
trade, from the same list the Businesses table uses. *Business Category* stays
as the applicant's own answer; *Confirmed Category* is the one that counts.

### Where the slots are tracked

In the **Business Sales Funnel Manager** base, on **Schools**:

| Field | What it tells you |
| --- | --- |
| Sponsor Capacity | How many sponsors this school can carry. Set per school. Blank means no cap agreed; 0 means closed to new sponsors. |
| Sponsors Committed | Signed sponsors attached to this school. Counts Closed Won only. |
| Slots Remaining | Capacity minus committed. Sort on it to see where there is room to sell. |
| Categories Taken | Which trades are already held here. Compare against Confirmed Category. |
| Availability | ✅ N of M slots open / ⛔ Full / ⚙️ No capacity set. |

A prospect being talked to never occupies a slot or blocks a category — only a
**Closed Won** business does. So the pipeline can never make a school look
fuller than it is.

### Doing the check

For each school in **Assigned Schools**, open that school in the Sales Funnel
base and confirm both:

1. **Availability** shows open slots.
2. **Confirmed Category** does *not* appear in **Categories Taken**.

Then tick check 6. Never tick it on the applicant's say-so.

**Set Sponsor Capacity on all nine schools before relying on this.** Until you
do, every school reads "No capacity set" and the capacity half of the check
tells you nothing.

### The one manual step

The three bases cannot link to each other — Airtable has no cross-base links —
so **Assigned Schools** is a list of school names, not a live link, and the
availability lookup is something a person does rather than something the base
computes. With nine schools that is a few seconds of scrolling; it is not worth
the machinery to automate, and a human confirming a school is available before
a $9,997 promise is arguably the right place for a human anyway.

The consequence worth knowing: a sponsor who arrives through the application
form does **not** automatically appear in the Businesses table, so they do not
automatically occupy a slot or block their category. Add them to Businesses as
Closed Won when you approve them, or the next applicant in that trade will look
clear when they are not.

## Re-verify at renewal

**Verified On** exists so that checks older than a sponsorship year get re-run
before renewal. A business that was clean last year may not be this year.
