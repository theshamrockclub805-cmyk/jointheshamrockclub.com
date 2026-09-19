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

### What is automatic, and what is not

**Automatic.** When an approved application syncs, it is also written into the
**Businesses** table as *Closed Won*, linked to its assigned schools and
carrying its confirmed category. That record is what occupies the school's slot
and blocks the category, so the next applicant in the same trade sees it. If
the business is already in the outbound pipeline as a prospect — which is
common, since a business you were already chasing may well apply — that record
is advanced rather than duplicated, and its existing notes are kept.

The application stores the resulting id in **Sales Funnel Record**, so all
three bases can be traced to each other.

**Not automatic.** The availability *lookup* is still a person's job: the three
bases cannot link to each other, so **Assigned Schools** is a list of names
rather than a live link, and nothing computes check 6 for you. With ten schools
that is a few seconds of scrolling — and a human confirming a school is free
before a $9,997 promise is arguably where a human belongs.

### Order of operations

The sync writes the slot **before** it creates the Client. The slot write is
idempotent, so a later failure retries harmlessly; creating a Client twice
would duplicate a sponsor. If the slot cannot be written — an unknown school
name, a token that cannot reach the Sales Funnel base — the whole application
is held and retried next run, rather than creating a Client whose category
nobody is blocking.

## Re-verify at renewal

**Verified On** exists so that checks older than a sponsorship year get re-run
before renewal. A business that was clean last year may not be this year.
