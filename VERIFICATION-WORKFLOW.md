# Verifying an applicant before you approve them

Applications are not accepted on submission. Two things have to be true before
a business becomes a sponsor:

1. **The business is legitimate** — and appropriate to put in front of students.
2. **The school and category they asked for are actually available.**

This document covers step 1, which is built. Step 2 is not built yet — see
"School and category availability" at the bottom.

## Why this exists

A sponsor's name and logo end up on a banner at a high school, in a newsletter
that goes to parents, and on social accounts students follow. The nonprofit's
standing with its schools depends on never having to explain why a particular
logo is on that banner. The cost of a slow approval is a mildly impatient
applicant. The cost of a bad one is a school relationship.

## The five checks

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
| ⏳ Not ready — N of 5 checks outstanding | Keep going. |
| ⚠️ All 5 checks done — set Verification Status to Passed | Finish the job: flip the status. |
| ✅ Cleared — safe to approve | Approve away. |
| ⛔ Do not approve — failed verification | Reject, and say why in the notes. |

Note the second row. Ticking **Verification Status = Passed** over an
unfinished checklist does not read as cleared, and it does not release the
application. A rushed review cannot be made to look like a finished one.

## It is enforced, not just advised

`netlify/functions/sync-approved.js` applies the same rule in code. An
application marked Approved whose verification has not passed **will not create
a Client**, so it never reaches the deliverables hub and never gets a payment
link. The function re-tests the status *and* all five checks independently.

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

## Re-verify at renewal

**Verified On** exists so that checks older than a sponsorship year get re-run
before renewal. A business that was clean last year may not be this year.

## School and category availability — not built yet

The second gate cannot be built as things stand, because the data is not there:

- The **Schools** table holds only a name and a link to Businesses. There is no
  capacity, no per-tier slots, and no record of which categories are taken.
- **Preferred School or Program** on an application is free text, not a link to
  a school, so nothing can be checked against it automatically.

Two policy questions decide the shape of that work: whether category
exclusivity means one sponsor per category per school, and whether a school has
a cap on total sponsors. Both need answering before the schema is worth
changing.
