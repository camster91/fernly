<<<<<<< HEAD
// Crisis detection test suite — runs against src/safety/crisis.ts directly.
// v0 has no test runner wired (P1 #15), so this lives as a standalone Node
// script. Run with: `node scripts/test-crisis.mjs`
//
// When the repo gets Jest (PR #6), migrate these cases to crisis.test.ts.
=======
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
>>>>>>> 5ecaf51 (ci: ESLint + Prettier + GitHub Actions + Dependabot foundation)

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
<<<<<<< HEAD
  console.log(`\n# ${name}`);
  fn();
}

// === Original v0 patterns — must continue to pass (regression) ===
=======
  console.log(`# ${name}`);
  fn();
}

// === v0 baseline regression — these MUST pass before PR #3 lands ===
>>>>>>> 5ecaf51 (ci: ESLint + Prettier + GitHub Actions + Dependabot foundation)
group('v0 hard patterns (regression)', () => {
  expect(detectCrisis('I want to die').level, 'hard', '"I want to die" → hard');
  expect(detectCrisis('I want to kill myself').level, 'hard', '"I want to kill myself" → hard');
  expect(detectCrisis("I don't want to live").level, 'hard', '"I don\'t want to live" → hard');
<<<<<<< HEAD
  expect(detectCrisis("I don't want to be alive").level, 'hard', '"I don\'t want to be alive" → hard');
  expect(detectCrisis("I don't want to exist").level, 'hard', '"I don\'t want to exist" → hard');
  expect(detectCrisis('going to kill myself tomorrow').level, 'hard', '"going to kill myself tomorrow" → hard');
  expect(detectCrisis("I'm suicidal").level, 'hard', '"I\'m suicidal" → hard');
  expect(detectCrisis('overdose').level, 'hard', '"overdose" → hard');
  expect(detectCrisis('cut myself').level, 'hard', '"cut myself" → hard');
  expect(detectCrisis('hurt myself').level, 'hard', '"hurt myself" → hard');
  expect(detectCrisis("I can't go on").level, 'hard', '"I can\'t go on" → hard');
  expect(detectCrisis("I can't do this anymore").level, 'hard', '"I can\'t do this anymore" → hard');
});

group('v0 soft patterns (regression)', () => {
  expect(detectCrisis('I want to give up').level, 'soft', '"I want to give up" → soft');
  expect(detectCrisis('no point').level, 'soft', '"no point" → soft');
  expect(detectCrisis("what's the point").level, 'soft', '"what\'s the point" → soft');
  expect(detectCrisis('empty inside').level, 'soft', '"empty inside" → soft');
});

group('v0 context overrides (false-positive guard)', () => {
  expect(detectCrisis('I killed it').level, 'none', '"I killed it" → none');
  expect(detectCrisis('dying of laughter').level, 'none', '"dying of laughter" → none');
  expect(detectCrisis('want to die laughing').level, 'none', '"want to die laughing" → none');
  expect(detectCrisis("school is killing me").level, 'none', '"school is killing me" → none');
  expect(detectCrisis("this is killing me").level, 'none', '"this is killing me" → none');
  expect(detectCrisis("my job is killing me").level, 'none', '"my job is killing me" → none');
  expect(detectCrisis("dying of embarrassment").level, 'none', '"dying of embarrassment" → none');
});

group('clean text (regression)', () => {
  expect(detectCrisis('hi').level, 'none', '"hi" → none');
  expect(detectCrisis('how are you').level, 'none', '"how are you" → none');
  expect(detectCrisis("I'm sad today").level, 'none', '"I\'m sad today" → none');
  expect(detectCrisis("I'm anxious about tomorrow").level, 'none', '"I\'m anxious about tomorrow" → none');
  expect(detectCrisis("today was hard").level, 'none', '"today was hard" → none');
  expect(detectCrisis('').level, 'none', '"" → none');
  expect(detectCrisis('   ').level, 'none', '"   " → none');
});

// === v0.2 normalization layer ===
group('zero-width joiner bypass', () => {
  // k\u200b i\u200b l\u200b l\u200b m\u200b y\u200b s\u200b e\u200b l\u200b f
  const zwj = 'k\u200bi\u200bl\u200bl\u200b m\u200by\u200bs\u200be\u200bl\u200bf';
  expect(detectCrisis(zwj).level, 'hard', 'ZWJ-spaced "kill myself" → hard');
  expect(detectCrisis('k\u200bill my\u200bself').level, 'hard', 'partial ZWJ → hard');
});

group('letter-spacing bypass', () => {
  expect(detectCrisis('k i l l   m y s e l f').level, 'hard', 'spaced "k i l l   m y s e l f" → hard');
  expect(detectCrisis('s u i c i d e').level, 'hard', 'spaced "s u i c i d e" → hard');
});

group('leetspeak bypass', () => {
  expect(detectCrisis('k1ll mys3lf').level, 'hard', 'leetspeak "k1ll mys3lf" → hard');
  expect(detectCrisis('su1c1d3').level, 'hard', 'leetspeak "su1c1d3" → hard');
  expect(detectCrisis('0v3rd0s3').level, 'hard', 'leetspeak "0v3rd0s3" → hard');
});

// === v0.2 gen-z shorthand ===
group('gen-z shorthand', () => {
  expect(detectCrisis('kms rn').level, 'hard', '"kms rn" → hard');
  expect(detectCrisis('kys').level, 'hard', '"kys" → hard');
  expect(detectCrisis('kms lol').level, 'hard', '"kms lol" → hard');
  expect(detectCrisis('unalive myself').level, 'hard', '"unalive myself" → hard');
  expect(detectCrisis('i wanna unalive').level, 'hard', '"i wanna unalive" → hard');
  expect(detectCrisis('permadeath').level, 'hard', '"permadeath" → hard');
});

group('euphemistic ideation', () => {
  expect(detectCrisis('end it').level, 'hard', '"end it" → hard');
  expect(detectCrisis('end my pain').level, 'hard', '"end my pain" → hard');
  expect(detectCrisis('better off dead').level, 'hard', '"better off dead" → hard');
  expect(detectCrisis('permanent solution').level, 'hard', '"permanent solution" → hard');
  expect(detectCrisis("i'm tired of being alive").level, 'hard', '"I\'m tired of being alive" → hard');
  expect(detectCrisis('no reason to live').level, 'hard', '"no reason to live" → hard');
  expect(detectCrisis("can't keep going").level, 'hard', '"can\'t keep going" → hard');
});

group('method mentions', () => {
  expect(detectCrisis('self harm').level, 'hard', '"self harm" → hard');
  expect(detectCrisis('jumping off a bridge').level, 'hard', '"jumping off a bridge" → hard');
  expect(detectCrisis('i have a plan to end it').level, 'hard', '"I have a plan to end it" → hard');
});

// === v0.2 non-English locales ===
group('Spanish', () => {
  expect(detectCrisis('me quiero morir').level, 'hard', '"me quiero morir" → hard');
  expect(detectCrisis('quiero suicidarme').level, 'hard', '"quiero suicidarme" → hard');
  expect(detectCrisis('no quiero vivir').level, 'hard', '"no quiero vivir" → hard');
  expect(detectCrisis('estoy harto de vivir').level, 'hard', '"estoy harto de vivir" → hard');
});

group('French', () => {
  expect(detectCrisis('je veux mourir').level, 'hard', '"je veux mourir" → hard');
  expect(detectCrisis('je n\'en peux plus').level, 'hard', '"je n\'en peux plus" → hard');
  expect(detectCrisis("plus envie de vivre").level, 'hard', '"plus envie de vivre" → hard');
});

group('Portuguese', () => {
  expect(detectCrisis('quero morrer').level, 'hard', '"quero morrer" → hard');
  expect(detectCrisis('não quero viver').level, 'hard', '"não quero viver" → hard');
});

// === Resource routing ===
group('crisisResourcesFor routing', () => {
  const us = crisisResourcesFor('en-US');
  expect(us[0].phone, '988', 'US primary phone = 988');
  expect(us.some(r => r.text === 'HOME to 741741'), true, 'US has text line');
=======
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
>>>>>>> 5ecaf51 (ci: ESLint + Prettier + GitHub Actions + Dependabot foundation)

  const uk = crisisResourcesFor('en-GB');
  expect(uk[0].phone, '116 123', 'UK primary phone = 116 123');

<<<<<<< HEAD
  const es = crisisResourcesFor('es-MX');
  expect(es.length > 0, true, 'es-MX has resources');
  expect(es.some(r => (r.phone || '').includes('800')), true, 'es-MX has MX line');

  const fr = crisisResourcesFor('fr-FR');
  expect(fr[0].phone, '3114', 'fr-FR primary phone = 3114');

  const pt = crisisResourcesFor('pt-BR');
  expect(pt[0].phone, '188', 'pt-BR primary phone = 188');

  const de = crisisResourcesFor('de-DE');
  expect(de[0].phone?.startsWith('0800'), true, 'de-DE starts with 0800');

  // Unknown locale falls back to IASP directory, never empty
  const xx = crisisResourcesFor('xx-XX');
  expect(xx.length > 0, true, 'unknown locale returns fallback');
  expect(xx[0].url?.includes('iasp.info'), true, 'unknown locale falls back to IASP');
});

// === Matched phrase reporting ===
group('matchedPhrase reporting', () => {
  expect((detectCrisis('kms rn').matchedPhrase?.length ?? 0) > 0, true, 'matchedPhrase populated for kms');
  expect(detectCrisis('hi').matchedPhrase, undefined, 'no matchedPhrase for clean text');
=======
  const xx = crisisResourcesFor('xx-XX');
  expect(xx.length > 0, true, 'unknown locale returns fallback');
>>>>>>> 5ecaf51 (ci: ESLint + Prettier + GitHub Actions + Dependabot foundation)
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
<<<<<<< HEAD
  console.log('\nFailures:');
=======
  console.log('Failures:');
>>>>>>> 5ecaf51 (ci: ESLint + Prettier + GitHub Actions + Dependabot foundation)
  for (const f of failures) console.log(f);
  process.exit(1);
}
