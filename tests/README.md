# Tests

```
npm test                 # everything
npm test referral        # only files whose name contains "referral"
VERBOSE=1 npm test       # include what the code logged while running
```

Exit code is 0 only if nothing failed. No framework and no install step: the
site has one dependency and no build, and a test suite nobody can run is worse
than none.

## Why these exist

They live in the repo because they did not, once, and a container restart wiped
a session's worth of them. Anything worth keeping goes here.

Each one guards something that has actually gone wrong on this project:

| File | Guards |
| --- | --- |
| `referral-payout.test.js` | The 15% owed to a referrer's school program: who is owed, how much, and that nothing is payable before the sponsor has paid us. |
| `terms-consistency.test.js` | That the agreement, the confirmation page, the founder email and the version stamped on signings all state the same terms. This has drifted twice. |
| `application-form.test.js` | The referral block on the live form, which is all show/hide behaviour — reading the markup proves nothing. Needs a browser. |
| `approved-sync.test.js` | The scheduled sync across all three bases: the retry hole that left a sponsor holding a slot nobody charged, the verification gate, the Oxnard hold, founder registration, and that an idle tick stays cheap. |
| `payment-guard.test.js` | That `/pay` refuses anyone who does not owe money yet, and that Stripe is never even contacted for them. |
| `welcome-heartbeat.test.js` | That the welcome job reports in on every working tick, names the sponsor and reason when one is missed, and cannot be brought down by the health table it writes to. |

## Writing one

A test file exports an async function that takes a recorder:

```js
module.exports = async function (t) {
  t('a name for the check', someCondition, detailShownOnlyOnFailure);
};
```

Helpers are in `lib/harness.js`:

- `readRepo('index.html')` — a repo file as text
- `freshRequire('netlify/lib/emails.js')` — a repo module, cache cleared, so one
  test's stubs cannot leak into the next
- `repoPath(...)` — an absolute path from the repo root
- `playwright()` — the browser driver, or `null`
- `Skip` — throw one to report a suite as skipped rather than failed

Always resolve paths through the harness. Never hard-code an absolute path: it
works on exactly one machine, and that is how the first set got lost.

## Browser tests

Playwright is deliberately not a dependency — the site has no build step and
needs no browser to deploy. A suite that wants one and cannot find it reports
`skipped`, so `npm test` still means something without it. The harness looks in
`node_modules`, then at `/opt/node-tools/node_modules/playwright` (present in
the cloud dev container).

## Stubs

`stubStripe()` replaces the `stripe` package outright for the duration of a
test, and counts checkout attempts. It is unconditional, not a fallback: a test
must never be able to reach Stripe, and the most valuable assertion about the
payment guard is that checkout was never *attempted*. It also means these run
with no `node_modules`, which is the state this repo is usually in.

`alwaysWorkingTick()` freezes the 90-minute cadence gate open. The scheduled
functions only do work on every third 30-minute tick, so without it a handler
test passes or fails depending on the wall clock.

Both return a handle with `.restore()`. Call it in a `finally`.

## Verifying a test can fail

A suite that only ever passes is decoration. Each of these has been checked by
breaking the thing it guards and confirming it fails on the right line — drop
`AGREEMENT_VERSION` by one, remove the `Pushed to Deliverables Hub` branch from
the sync, or short-circuit `notYetBillable` in `pay.js`. Worth repeating for
anything new.

## What is not covered

Lost with the scratchpad and not yet rebuilt. Worth adding when something in
the area is next touched:

- the Netlify Forms fallback when the function is down
- form security: honeypot, method check, SSN rejection
- `sync-approved`'s own heartbeat is covered only through the sync tests; the
  shared reporter in `netlify/lib/health.js` is exercised directly by
  `welcome-heartbeat`
