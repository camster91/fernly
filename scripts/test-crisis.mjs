// Crisis detection test suite — v0 baseline.
//
// v0.1 of this file (added in PR #3): extended with gen-z shorthand,
// leetspeak, ZWJ bypass, letter-spacing bypass, and Spanish/French/
// Portuguese phrases. 74 cases.
//
// Until PR #3 lands, this file only runs the v0 baseline regressions so
// CI doesn't gate-keep PR #6 (the CI foundation PR) on tests that don't
// exist yet. After PR #3 merges, this file is replaced with the v0.2
// 74-case suite.
//
// Run with: npx tsx scripts/test-crisis.mjs

import { detectCrisis, crisisResourcesFor } from '../src/safety/crisis.js';

let pass = 0;
let fail = 0;
const failures = [];

function expect(actual, expected, label) {
  const ok = actual === expected;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`  FAIL: ${label} — expected "${expected}", got "${actual}"`);
  }
}

function group(name, fn) {
  console.log(`# ${name}`);
  fn();
}

// === v0 baseline regression — these MUST pass before PR #3 lands ===
group('v0 hard patterns (regression)', () => {
  expect(detectCrisis('I want to die').level, 'hard', '"I want to die" → hard');
  expect(detectCrisis('I want to kill myself').level, 'hard', '"I want to kill myself" → hard');
  expect(detectCrisis("I don't want to live").level, 'hard', '"I don\'t want to live" → hard');
  expect(detectCrisis("I'm suicidal").level, 'hard', '"I\'m suicidal" → hard');
  expect(detectCrisis('overdose').level, 'hard', '"overdose" → hard');
  expect(detectCrisis('cut myself').level, 'hard', '"cut myself" → hard');
});

group('v0 context overrides', () => {
  expect(detectCrisis('I killed it').level, 'none', '"I killed it" → none');
  expect(detectCrisis('dying of laughter').level, 'none', '"dying of laughter" → none');
});

group('clean text', () => {
  expect(detectCrisis('hi').level, 'none', '"hi" → none');
  expect(detectCrisis("I'm sad today").level, 'none', '"I\'m sad today" → none');
  expect(detectCrisis('').level, 'none', '"" → none');
});

group('crisisResourcesFor (v0)', () => {
  const us = crisisResourcesFor('en-US');
  expect(us[0].phone, '988', 'US primary phone = 988');
  expect(
    us.some((r) => r.text === 'HOME to 741741'),
    true,
    'US has text line',
  );

  const uk = crisisResourcesFor('en-GB');
  expect(uk[0].phone, '116 123', 'UK primary phone = 116 123');

  const xx = crisisResourcesFor('xx-XX');
  expect(xx.length > 0, true, 'unknown locale returns fallback');
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
