#!/usr/bin/env node
'use strict';

/**
 * Runs every *.test.js in this directory. `npm test`.
 *
 * Each test file exports an async function that takes a suite recorder and
 * records checks on it. A file that cannot run here - a browser suite on a
 * machine with no Playwright - throws harness.Skip and is reported as skipped
 * rather than failed, so a missing optional tool never reads as a broken site.
 *
 * Exit code is 0 only if nothing failed. Skips do not fail the run; they are
 * counted and named at the end so they cannot quietly become permanent.
 */

const fs = require('fs');
const path = require('path');
const { suite } = require('./lib/harness');

const GREEN = '\u001b[32m', RED = '\u001b[31m', DIM = '\u001b[2m', YELLOW = '\u001b[33m', OFF = '\u001b[0m';

async function main() {
  const only = process.argv[2];
  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => !only || f.includes(only))
    .sort();

  if (files.length === 0) {
    console.error('No test files matched' + (only ? ' "' + only + '"' : '') + '.');
    process.exit(1);
  }

  let passed = 0, failed = 0;
  const skipped = [];
  const failures = [];

  for (const file of files) {
    const run = require(path.join(__dirname, file));
    const t = suite(file.replace('.test.js', ''));

    // The functions under test log a lot on purpose - it is how they explain
    // themselves in production. Capture it rather than let it bury the result,
    // and print it only where it helps: on a failure, or with VERBOSE=1.
    const captured = [];
    const realConsole = { log: console.log, warn: console.warn, error: console.error };
    const capture = stream => (...args) =>
      captured.push(stream + ': ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    if (!process.env.VERBOSE) {
      console.log = capture('log'); console.warn = capture('warn'); console.error = capture('error');
    }

    try {
      await run(t);
    } catch (err) {
      if (err && err.isSkip) {
        Object.assign(console, realConsole);
        skipped.push(file + ' — ' + err.message);
        console.log(`${YELLOW}skip${OFF}  ${t.title} ${DIM}(${err.message})${OFF}`);
        continue;
      }
      t('suite ran without throwing', false, err && err.stack ? err.stack : String(err));
    } finally {
      Object.assign(console, realConsole);
    }

    const bad = t.checks.filter(c => !c.ok);
    passed += t.passed();
    failed += bad.length;
    const mark = bad.length ? `${RED}fail${OFF}` : `${GREEN} ok ${OFF}`;
    console.log(`${mark}  ${t.title} ${DIM}${t.passed()}/${t.checks.length}${OFF}`);
    for (const c of bad) {
      failures.push({ suite: t.title, name: c.name, detail: c.detail });
      console.log(`      ${RED}✗${OFF} ${c.name}`);
      if (c.detail !== undefined) {
        const d = typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail);
        console.log(`        ${DIM}${String(d).split('\n').join('\n        ')}${OFF}`);
      }
    }
    if (bad.length && captured.length) {
      console.log(`      ${DIM}what the code logged while this ran:${OFF}`);
      for (const line of captured) console.log(`        ${DIM}${line}${OFF}`);
    }
  }

  console.log();
  console.log(`${passed} passed, ${failed} failed` + (skipped.length ? `, ${skipped.length} skipped` : ''));
  for (const s of skipped) console.log(`  ${YELLOW}skipped${OFF} ${s}`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
