'use strict';

/**
 * The smallest test harness that does the job.
 *
 * No framework, because this repo has no build step and one dependency, and a
 * test suite nobody can run is worse than none. `node tests/run.js` is the
 * whole story.
 *
 * Paths resolve from the repo, never from an absolute location: these tests
 * were lost once already because they lived outside it.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

/** A path inside the repo, e.g. repoPath('netlify/lib/emails.js'). */
function repoPath(...parts) {
  return path.join(ROOT, ...parts);
}

/** Read a repo file as text. */
function readRepo(...parts) {
  return fs.readFileSync(repoPath(...parts), 'utf8');
}

/** Require a repo module fresh, so one test's stubs cannot leak into the next. */
function freshRequire(relative) {
  const full = repoPath(relative);
  delete require.cache[require.resolve(full)];
  return require(full);
}

/**
 * Playwright, wherever it happens to live.
 *
 * It is not a dependency of this repo: the site has no build step and does not
 * need a browser to deploy. Browser tests are therefore a bonus, not a gate.
 * A suite that needs it and cannot find it reports SKIPPED rather than failing,
 * so `npm test` still means something on a machine without it.
 */
function playwright() {
  const candidates = [
    'playwright',
    '/opt/node-tools/node_modules/playwright',
    path.join(ROOT, 'node_modules', 'playwright')
  ];
  for (const c of candidates) {
    try { return require(c); } catch (err) { /* try the next */ }
  }
  return null;
}

/** Raised by a suite that cannot run here. run.js reports it as skipped. */
class Skip extends Error {
  constructor(why) { super(why); this.isSkip = true; }
}

/**
 * One suite's results. `t(name, condition, detail)` records a check; detail is
 * printed only on failure, which keeps a passing run readable and a failing one
 * informative.
 */
function suite(title) {
  const checks = [];
  function t(name, condition, detail) {
    checks.push({ name, ok: Boolean(condition), detail });
  }
  t.title = title;
  t.checks = checks;
  t.passed = () => checks.filter(c => c.ok).length;
  t.failed = () => checks.filter(c => !c.ok).length;
  return t;
}

module.exports = { ROOT, repoPath, readRepo, freshRequire, playwright, Skip, suite };
