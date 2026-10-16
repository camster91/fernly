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

  // v0.9 (F-P1-2 follow-up): explicit pattern catches the
  // leet+space hybrid. The normalizer can't safely collapse 2+1
  // letter runs across spaces (Portuguese false-positive risk),
  // so we hit this specific shape directly.
  it('"k1ll m3" must be hard', () => {
    expect(detectCrisis('k1ll m3').level).toBe('hard');
  });
  it('"k1llme" must be hard (no space variant)', () => {
    expect(detectCrisis('k1llme').level).toBe('hard');
  });
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

// === v0.2 regression corpus — ported from scripts/test-crisis.mjs.
// The original mjs file is unrunnable under Node 20+ (esbuild +
// react-native/index.js "Unexpected typeof" parse error). The
// cases below are equivalent to the mjs assertions. Plans/05
// P1-2 / F-P1-2.

describe('crisis detector: v0 hard patterns (regression)', () => {
  it.each([
    'I want to die',
    'I want to kill myself',
    "I don't want to live",
    "I don't want to be alive",
    "I don't want to exist",
    'going to kill myself tomorrow',
    "I'm suicidal",
    'overdose',
    'cut myself',
    'hurt myself',
    "I can't go on",
    "I can't do this anymore",
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis detector: v0 soft patterns (regression)', () => {
  it.each(['I want to give up', 'no point', "what's the point", 'empty inside'])(
    '"%s" must be soft',
    (input) => {
      expect(detectCrisis(input).level).toBe('soft');
    },
  );
});

describe('crisis detector: v0 false-positive guards (regression)', () => {
  it.each([
    'I killed it',
    'dying of laughter',
    'want to die laughing',
    'school is killing me',
    'this is killing me',
    'my job is killing me',
    'dying of embarrassment',
  ])('"%s" must be none', (input) => {
    expect(detectCrisis(input).level).toBe('none');
  });
});

describe('crisis detector: clean text (regression)', () => {
  it.each(['hi', 'how are you', "I'm sad today", "I'm anxious about tomorrow", 'today was hard'])(
    '"%s" must be none',
    (input) => {
      expect(detectCrisis(input).level).toBe('none');
    },
  );
  it('empty string must be none', () => {
    expect(detectCrisis('').level).toBe('none');
  });
  it('whitespace must be none', () => {
    expect(detectCrisis('   ').level).toBe('none');
  });
});

describe('crisis detector: zero-width joiner bypass (regression)', () => {
  const zwj = 'k\u200bi\u200bl\u200bl\u200b m\u200by\u200bs\u200be\u200bl\u200bf';
  it('ZWJ-spaced "kill myself" must be hard', () => {
    expect(detectCrisis(zwj).level).toBe('hard');
  });
  it('partial ZWJ "k\u200bill my\u200bself" must be hard', () => {
    expect(detectCrisis('k\u200bill my\u200bself').level).toBe('hard');
  });
});

describe('crisis detector: letter-spacing bypass (regression)', () => {
  it.each(['k i l l   m y s e l f', 's u i c i d e'])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis detector: leetspeak bypass (regression)', () => {
  it.each(['k1ll mys3lf', 'su1c1d3', '0v3rd0s3'])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis detector: gen-z shorthand (regression)', () => {
  it.each(['kms rn', 'kys', 'kms lol', 'unalive myself', 'i wanna unalive', 'permadeath'])(
    '"%s" must be hard',
    (input) => {
      expect(detectCrisis(input).level).toBe('hard');
    },
  );
});

describe('crisis detector: euphemistic ideation (regression)', () => {
  it.each([
    'end it',
    'end my pain',
    'better off dead',
    'permanent solution',
    "i'm tired of being alive",
    'no reason to live',
    "can't keep going",
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis detector: method mentions (regression)', () => {
  it.each(['self harm', 'jumping off a bridge', 'i have a plan to end it'])(
    '"%s" must be hard',
    (input) => {
      expect(detectCrisis(input).level).toBe('hard');
    },
  );
});

describe('crisis detector: Spanish (regression)', () => {
  it.each(['me quiero morir', 'quiero suicidarme', 'no quiero vivir', 'estoy harto de vivir'])(
    '"%s" must be hard',
    (input) => {
      expect(detectCrisis(input).level).toBe('hard');
    },
  );
});

describe('crisis detector: French (regression)', () => {
  it.each(['je veux mourir', "je n'en peux plus", 'plus envie de vivre'])(
    '"%s" must be hard',
    (input) => {
      expect(detectCrisis(input).level).toBe('hard');
    },
  );
});

describe('crisis detector: Portuguese (regression)', () => {
  it.each(['quero morrer', 'não quero viver'])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis modal: resource routing by locale', () => {
  it('US primary phone is 988', () => {
    expect(crisisResourcesFor('en-US')[0].phone).toBe('988');
  });
  it('US has HOME to 741741 text line', () => {
    expect(crisisResourcesFor('en-US').some((r) => r.text === 'HOME to 741741')).toBe(true);
  });
  it('UK primary phone is 116 123', () => {
    expect(crisisResourcesFor('en-GB')[0].phone).toBe('116 123');
  });
  it('es-MX has resources including an 800-prefix line', () => {
    const r = crisisResourcesFor('es-MX');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((x) => (x.phone || '').includes('800'))).toBe(true);
  });
  it('fr-FR primary phone is 3114', () => {
    expect(crisisResourcesFor('fr-FR')[0].phone).toBe('3114');
  });
  it('pt-BR primary phone is 188', () => {
    expect(crisisResourcesFor('pt-BR')[0].phone).toBe('188');
  });
  it('de-DE primary phone starts with 0800', () => {
    expect(crisisResourcesFor('de-DE')[0].phone?.startsWith('0800')).toBe(true);
  });
  it('unknown locale returns IASP fallback', () => {
    const r = crisisResourcesFor('xx-XX');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].url?.includes('iasp.info')).toBe(true);
  });
});

describe('crisis detector: matchedPhrase reporting (regression)', () => {
  it('populated for kms rn', () => {
    expect((detectCrisis('kms rn').matchedPhrase?.length ?? 0) > 0).toBe(true);
  });
  it('absent for clean text', () => {
    expect(detectCrisis('hi').matchedPhrase).toBeUndefined();
  });
});

describe('crisis detector: benign idiom must not mask real ideation (regression)', () => {
  it.each([
    'I killed it at work today but honestly I want to kill myself',
    'work is killing me and I want to die',
    "I'm glad to be alive? no. I want to end it all",
    'lol dying of laughter. jk i want to kill myself',
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
  it.each(['I killed it at work today', 'work is killing me', 'I want to die laughing'])(
    '"%s" stays none',
    (input) => {
      expect(detectCrisis(input).level).toBe('none');
    },
  );
});

describe('crisis detector: common phrasings (regression)', () => {
  it.each([
    'i wanna die',
    'wanna die rn',
    'I don’t want to have been alive',
    'I don’t want to be alive',
    'I wish I wasn’t alive',
  ])('"%s" must be hard', (input) => {
    expect(detectCrisis(input).level).toBe('hard');
  });
});

describe('crisis modal: resource routing by region', () => {
  const phones = (locale: string) =>
    crisisResourcesFor(locale)
      .map((r) => r.phone)
      .filter(Boolean);
  it('en-CA gets 988', () => {
    expect(phones('en-CA')).toContain('988');
  });
  it('fr-CA gets 988, not France 3114', () => {
    expect(phones('fr-CA')).toContain('988');
    expect(phones('fr-CA')).not.toContain('3114');
  });
  it('es-US gets 988, not Mexico/Spain numbers', () => {
    expect(phones('es-US')[0]).toBe('988');
    expect(phones('es-US')).not.toContain('800 911 2000');
  });
  it('en-AU gets Lifeline 13 11 14', () => {
    expect(phones('en-AU')).toContain('13 11 14');
  });
  it('en-IE gets Samaritans 116 123', () => {
    expect(phones('en-IE')).toContain('116 123');
  });
  it('de-AT gets 142, de-CH gets 143, not the German number', () => {
    expect(phones('de-AT')).toContain('142');
    expect(phones('de-CH')).toContain('143');
    expect(phones('de-AT')).not.toContain('0800 111 0 111');
  });
  it('es-ES gets 024', () => {
    expect(phones('es-ES')[0]).toBe('024');
  });
  it('pt-PT does not get Brazil 188', () => {
    expect(phones('pt-PT')).not.toContain('188');
  });
  it('unknown region falls back to directories, never another country’s number', () => {
    expect(phones('es-AR')).toEqual([]);
    expect(crisisResourcesFor('es-AR')[0].url).toContain('iasp.info');
  });
  it('accepts underscore and script subtags', () => {
    expect(phones('en_GB')).toContain('116 123');
    expect(phones('zh-Hant-TW').length).toBe(0);
  });
});
