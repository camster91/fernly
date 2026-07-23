// Crisis detector edge-case tests — vitest port of the
// scripts/test-crisis-edge-cases.mjs corpus. The original corpus
// was a runnable Node script using npx tsx, but Node 24 + esbuild +
// react-native/index.js produces an unexpected "typeof" parse
// error that fails the script entirely. Vitest handles the
// transform via its own pipeline, so this file provides the same
// coverage in a way the existing CI can run.
//
// Test categories:
//   1. Regression pinning — current detector behavior on inputs
//      that already work (punctuation, leetspeak, alive-phrase
//      reversal from v0.8's tightening).
//   2. Spec gaps — current detector behavior on inputs that
//      SHOULD work but don't yet (failing = room to grow). These
//      drive F-P1-2 follow-up work.

import { describe, expect, it, vi } from 'vitest';

// AsyncStorage / SecureStore / storage mock chain required because
// src/safety/crisis.ts transitively imports ../storage, which
// imports RN modules. Without mocks the SSR Rollup parse fails
// at react-native/index.js ("typeof" expected by was 'from').
const asyncData = new Map<string, string>();
const secureData = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => asyncData.get(k) ?? null,
    setItem: (k: string, v: string) => {
      asyncData.set(k, v);
      return undefined;
    },
    removeItem: (k: string) => {
      asyncData.delete(k);
      return undefined;
    },
    removeMany: (ks: string[]) => {
      ks.forEach((k) => asyncData.delete(k));
      return undefined;
    },
  },
}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => secureData.get(k) ?? null,
  setItemAsync: (k: string, v: string) => {
    secureData.set(k, v);
    return undefined;
  },
  deleteItemAsync: (k: string) => {
    secureData.delete(k);
    return undefined;
  },
}));

// Dynamic import after mocks per the storage.test.ts pattern.
const { detectCrisis, crisisResourcesFor } = await import('../../safety/crisis');

describe('crisis detector: punctuation and abbreviated bypasses (regression)', () => {
  it.each(['k y s', 'k.m.s.', 'k-m-s', 'k/m/s', 's.u.i.c.i.d.e'])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });

  // v0.9 (F-P1-2): Unicode / non-ASCII separator bypasses.
  // Crisis bypass forums post "k∶m∶s" or "k・m・s" to evade
  // ASCII-only normalizers. The detector's separator-collapse
  // step now matches the ratio sign, the dot operator (U+2219),
  // the katakana middle dot (U+30FB), and triangle colon
  // (U+2B1D).
  it.each(['k∶m∶s', 'k・m・s', 'k∙m∙s', 'k⬝m⬝s'])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });

  it.todo(
    '"k1ll m3" must be hard — leetspeak+letter-space hybrid. Blocked on a more ' +
      'aggressive normalizer (current collapse min is 4 letters; this token is 3+2). ' +
      'Punted to F-P1-2 follow-up because expanding the normalizer has Portuguese ' +
      'false-positive risk ("não a", "y a") that the simpler "hard pattern" route avoids.',
  );
});

describe('crisis detector: contemporary slang + euphemisms (spec)', () => {
  // Spec: "off myself", "ceiling myself", "CTB" (commit-to-breathe),
  // "check out permanently" must all hit hard.
  it.each([
    'I am going to off myself',
    'thinking about offing myself',
    'I have decided to CTB',
    'I want to check out permanently',
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });

  // Plain "the CTB project" prose must not escalate.
  it('does not flag "CTB" inside unrelated prose', () => {
    expect(detectCrisis('the CTB project is due Friday').level).toBe('none');
  });

  it.todo(
    '"I might ceiling myself tonight" must be hard — "ceiling" as a suicide ' +
      'euphemism is fringe-community slang, not a documented clinical vocabulary. ' +
      'Punted to F-P1-2 follow-up pending a clinician review.',
  );
});

describe('crisis detector: soft ideation (spec)', () => {
  // Spec: passive-disengagement phrasing should land in soft, not
  // none. Currently most of these return 'none' — they're the
  // documented gaps in plans/05 P1-2 / F-P1-2.
  it.each([
    "I'm so tired of being tired",
    'everything is grey',
    'there is no point in any of this',
    'nothing matters anymore',
    'I wish I could disappear',
  ])('"%s" must be soft', (input) => {
    expect(detectCrisis(input).level).toBe('soft');
  });
});

describe('crisis detector: positive "alive" phrases must NOT escalate (v0.8 regression)', () => {
  // Pins the v0.8 tightening of /\b(un|re)?alive(d)?/ which used to
  // match "alive" alone. Any new regression here means someone
  // re-widened the alive-pattern.
  it.each([
    "I'm so glad to be alive",
    "I'm glad to be alive",
    'I love being alive',
    "I'm happy to be alive",
    'being alive is a gift',
    'so glad I am alive today',
    'so grateful to be alive',
  ])('"%s" must be none', (input) => {
    expect(detectCrisis(input).level).toBe('none');
  });
});

describe('crisis detector: negative "alive" phrases must still escalate (v0.8 regression)', () => {
  it.each([
    'I wish I wasnt alive',
    'Im tired of being alive',
    "I don't want to be alive",
    'unalive me',
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis detector: method plus intent/action (spec)', () => {
  // Multi-token combinations like "<amount> pills and I don't want
  // to wake up". The detector needs to look beyond exact keywords
  // when qualifier phrases appear.
  it.each([
    'I took 30 pills and I do not want to wake up',
    'I have a rope ready to end it',
    'I am on the bridge and I plan to jump',
    'I saved enough pills to kill myself',
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });

  // Method nouns without intent must not independently escalate.
  it.each([
    'I need to pick up my prescription pills',
    'we drove across a bridge',
    'I bought rope for the garden',
  ])('"%s" must be none', (input) => {
    expect(detectCrisis(input).level).toBe('none');
  });
});

describe('crisis detector: additional translations (spec, pt-BR + es + fr)', () => {
  // Spec: French + Spanish + Portuguese. pt-BR detection is the
  // most important missing piece for the multilingual user
  // population the audit flagged.
  it.each([
    'je veux me tuer',
    'quiero matarme',
    'não aguento mais viver',
    'não quero mais estar vivo',
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis modal: unknown / malformed locale fallback (regression)', () => {
  // If someone refactors crisisResourcesFor and breaks the fallback,
  // the modal becomes a blank screen. Pin the fallback here.
  it.each(['', 'xx-XX', 'EN-us', 'invalid'])('locale %s has fallback resources', (locale) => {
    const resources = crisisResourcesFor(locale || '');
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.some((r) => r.phone || r.text || r.url)).toBe(true);
  });
});
