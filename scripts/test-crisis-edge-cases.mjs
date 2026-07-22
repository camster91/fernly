// Additional crisis-detector coverage for the cases the shipped
// test-crisis.mjs corpus doesn't exercise yet. Several assertions
// are intentionally SPECIFICATION — they FAIL against the current
// detector (commit dc72228 and the PR1 fix on top of it) until the
// detector grows the matching patterns. Run alongside the existing
// 74-case suite; both feed into `npm test`.
//
// Failures here drive fixes tracked in plans/03-post-merge-audit-2026-07-21.md
// P0 #14. Treat any new failing case as a regression report, not a
// bug — the detector is what needs to grow.

import { detectCrisis, crisisResourcesFor } from '../src/safety/crisis.js';

let pass = 0;
let fail = 0;
const failures = [];

function expectLevel(input, expected, label = input) {
  const actual = detectCrisis(input).level;
  if (actual === expected) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`FAIL: ${JSON.stringify(label)} — expected ${expected}, got ${actual}`);
  }
}

function expectTrue(actual, label) {
  if (actual) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`FAIL: ${label}`);
  }
}

function group(name, fn) {
  console.log(`# ${name}`);
  fn();
}

// Note: punctuation, letter-spacing, and leetspeak variants are
// shipped in the current detector — these verify they all still
// trigger hard-level detection. Failures here mean a regression,
// not a missing feature.
group('punctuation and abbreviated bypasses', () => {
  expectLevel('k y s', 'hard');
  expectLevel('k.m.s.', 'hard');
  expectLevel('k-m-s', 'hard');
  expectLevel('k/m/s', 'hard');
  expectLevel('k1ll m3', 'hard');
  expectLevel('s.u.i.c.i.d.e', 'hard');
});

group('contemporary slang and euphemisms', () => {
  expectLevel('I am going to off myself', 'hard');
  expectLevel('thinking about offing myself', 'hard');
  expectLevel('I might ceiling myself tonight', 'hard');
  expectLevel('I have decided to CTB', 'hard');
  expectLevel('I want to check out permanently', 'hard');

  // Do not treat an ambiguous acronym as hard inside unrelated prose.
  expectLevel('the CTB project is due Friday', 'none');
});

group('soft ideation', () => {
  expectLevel("I'm so tired of being tired", 'soft');
  expectLevel('everything is grey', 'soft');
  expectLevel('there is no point in any of this', 'soft');
  expectLevel('nothing matters anymore', 'soft');
  expectLevel('I wish I could disappear', 'soft');
});

group('positive "alive" phrases must NOT escalate (v0.8 regression)', () => {
  expectLevel("I'm so glad to be alive", 'none');
  expectLevel("I'm glad to be alive", 'none');
  expectLevel('I love being alive', 'none');
  expectLevel("I'm happy to be alive", 'none');
  expectLevel('being alive is a gift', 'none');
  expectLevel('so glad I am alive today', 'none');
  expectLevel('so grateful to be alive', 'none');
});

group('negative "alive" phrases must still escalate (v0.8 regression)', () => {
  expectLevel('I wish I wasnt alive', 'hard');
  expectLevel('Im tired of being alive', 'hard');
  expectLevel("I don't want to be alive", 'hard');
  expectLevel('unalive me', 'hard');
});

group('method plus intent/action', () => {
  expectLevel('I took 30 pills and I do not want to wake up', 'hard');
  expectLevel('I have a rope ready to end it', 'hard');
  expectLevel('I am on the bridge and I plan to jump', 'hard');
  expectLevel('I saved enough pills to kill myself', 'hard');

  // Method nouns without intent must not independently escalate.
  expectLevel('I need to pick up my prescription pills', 'none');
  expectLevel('we drove across a bridge', 'none');
  expectLevel('I bought rope for the garden', 'none');
});

group('false-positive context guards', () => {
  expectLevel('I nearly died laughing', 'none');
  expectLevel('that joke killed me', 'none');
  expectLevel('I killed it at work today', 'none');
  expectLevel('our team absolutely murdered that presentation', 'none');
  expectLevel('the game gave me permadeath mode', 'none');
});

group('additional translations and accents', () => {
  expectLevel('je veux me tuer', 'hard');
  expectLevel('quiero matarme', 'hard');
  expectLevel('não aguento mais viver', 'hard');
  expectLevel('não quero mais estar vivo', 'hard');
});

group('unknown and malformed locale fallback', () => {
  for (const locale of ['', 'xx-XX', 'EN-us', 'invalid']) {
    const resources = crisisResourcesFor(locale);
    expectTrue(resources.length > 0, `${locale || '<empty>'} has fallback resources`);
    expectTrue(
      resources.some((r) => r.phone || r.text || r.url),
      `${locale || '<empty>'} has actionable fallback`,
    );
  }
});

console.log(`\n${pass} pass, ${fail} fail`);

if (fail > 0) {
  console.error('\nFailures:');
  failures.forEach((failure) => console.error(failure));
  process.exit(1);
}
