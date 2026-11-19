# Tests

```
npm test                 # everything
npm test referral        # only files whose name contains "referral"
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

## What is not covered

These were lost with the scratchpad and have not been rebuilt. Worth adding back
when something in the area is next touched:

- the approved-application sync end to end (retry path, school slots, the Oxnard
  hold, founder registration)
- `/pay` refusing checkout for a sponsor who owes nothing
- the Netlify Forms fallback when the function is down
- form security: honeypot, method check, SSN rejection
- the Automation Health heartbeat surviving a broken table
