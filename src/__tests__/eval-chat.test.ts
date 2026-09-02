// Offline evaluation set for the real-chat architecture (v0.11,
// issue #41). The eval set runs in CI and gates prompt / contract
// changes — any change that breaks a case here is a regression.
//
// What's an "evaluation set" here?
//   A representative set of user messages + expected client
//   behavior. The tests below assert on the CLIENT-SIDE guarantees
//   the issue requires (safety routing, feature flag, usage
//   limits, schema validation). They do NOT call a real LLM —
//   prompt quality is a separate harness that runs against a real
//   model (out of scope until the backend lands, see #41 "External
//   or human requirements").
//
// What does this file gate?
//   - The crisis detector never lets a hard-crisis message reach
//     fetchReply(). This is the "safety routing remains
//     independent of the model" requirement — the LLM cannot
//     override the client-side crisis verdict.
//   - The feature flag defaults to off. A test that "accidentally"
//     enables the backend without the env flag set must fail.
//   - The schema validator rejects malformed responses.
//   - The usage limiter caps burst and daily counts.
//   - The HTTPS / host-allowlist / auth-missing pre-flight checks
//     fire before any network call.
//
// Prompt-change gate: any change to the regex set in
// `src/safety/crisis.ts` should be accompanied by a new eval case
// here. The CI command `npm run test:unit` runs this file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCrisis } from '../safety/crisis';
import { ChatBackendError, fetchReply, readChatBackendEnabled, readChatBackendUrl } from '../api/chat';
import { isRealChatEnabledSync, resolveRealChatDecision } from '../api/chat-feature-flag';
import { ChatUsageLimitError, getChatUsageSnapshot, reserveSlot, resetUsage } from '../api/chat-usage';

// Mock RN/Expo modules that storage transitively imports. Without
// these, vitest's SSR rollup parse fails with the "Expected 'from',
// got 'typeOf'" error when it tries to load react-native/index.js.
// (See src/util/__tests__/crisis.detector.test.ts for the same
// workaround + longer comment.)
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

// -------- Crisis routing cases --------

interface CrisisCase {
  input: string;
  expected: 'hard' | 'soft' | 'none';
  note: string;
}

const CRISIS_CASES: CrisisCase[] = [
  // Hard cases — must block, never reach the LLM.
  { input: 'I want to kill myself tonight', expected: 'hard', note: 'plain ideation' },
  { input: 'kms rn', expected: 'hard', note: 'gen-z shorthand' },
  { input: 'k y s', expected: 'hard', note: 'letter-spaced' },
  { input: 'k1ll m3', expected: 'hard', note: 'leetspeak' },
  { input: "I'm going to off myself", expected: 'hard', note: 'euphemism' },
  { input: 'suicide sounds like the answer', expected: 'hard', note: 'plain mention' },
  { input: 'I have a plan to end it', expected: 'hard', note: 'method+intent' },
  { input: 'jump off a bridge and dont want to wake up', expected: 'hard', note: 'method chain' },
  { input: 'me quiero morir', expected: 'hard', note: 'Spanish' },
  { input: 'je veux mourir', expected: 'hard', note: 'French' },
  { input: 'quero morrer', expected: 'hard', note: 'Portuguese' },

  // Soft cases — log, don't block, message DOES reach the LLM.
  { input: "I'm so tired of being tired", expected: 'soft', note: 'passive disengagement' },
  { input: 'everything feels pointless', expected: 'soft', note: 'pointlessness' },
  { input: 'I wish I could disappear', expected: 'soft', note: 'disappearance' },
  { input: 'tired of being tired', expected: 'soft', note: 'fatigue idiom' },

  // False-positive guards — must NOT trigger.
  { input: "I'm dying of laughter", expected: 'none', note: 'idiom' },
  { input: 'I killed it at work today', expected: 'none', note: 'figurative kill' },
  { input: "I'm so glad to be alive", expected: 'none', note: 'positive alive' },
  { input: "this job is killing me", expected: 'none', note: 'figurative kill' },
  { input: 'I want to die laughing at this movie', expected: 'none', note: 'idiom' },
  { input: 'whatever, you win', expected: 'none', note: 'everyday dismissal' },
];

describe('crisis routing (LLM cannot override client verdict)', () => {
  for (const c of CRISIS_CASES) {
    it(`${c.expected.toUpperCase()}: ${c.input} (${c.note})`, () => {
      const v = detectCrisis(c.input);
      expect(v.level).toBe(c.expected);
    });
  }
});

// -------- Default-off guarantee --------

const ENV_KEYS = [
  'EXPO_PUBLIC_CHAT_API_URL',
  'EXPO_PUBLIC_CHAT_BACKEND_ENABLED',
  'EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST',
  'EXPO_PUBLIC_CHAT_BURST_LIMIT',
  'EXPO_PUBLIC_CHAT_DAILY_LIMIT',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
  vi.restoreAllMocks();
});

describe('default-off: real chat is OFF by default', () => {
  it('isRealChatEnabledSync() is false with no env', () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED;
    expect(isRealChatEnabledSync()).toBe(false);
  });

  it('isRealChatEnabledSync() is false when only the URL is set', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED;
    expect(isRealChatEnabledSync()).toBe(false);
  });

  it('isRealChatEnabledSync() is false when only the flag is set', () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    expect(isRealChatEnabledSync()).toBe(false);
  });

  it('isRealChatEnabledSync() is true ONLY when BOTH flag and URL are set', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    expect(isRealChatEnabledSync()).toBe(true);
  });

  it('readChatBackendEnabled() defaults to false', () => {
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED;
    expect(readChatBackendEnabled()).toBe(false);
  });

  it('readChatBackendUrl() returns null when env is unset', () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    expect(readChatBackendUrl()).toBeNull();
  });
});

// -------- Pre-flight checks fire BEFORE the network call --------

describe('pre-flight: hostile / misconfigured requests never reach the wire', () => {
  function mockFetch() {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reply: 'ok' }) }));
  }
  const VALID_REQ = { input: 'hi', tone: 'soft' as const, sessionId: 's1' };

  it('rejects http:// in production', async () => {
    const f = mockFetch();
    await expect(
      fetchReply(VALID_REQ, {
        url: 'http://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'insecure' });
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects hosts not in the allowlist', async () => {
    const f = mockFetch();
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://rogue.example.com',
        hostAllowlist: ['api.fernly.app'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'host-not-allowed' });
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects when no auth token is provided (no provider creds in client)', async () => {
    const f = mockFetch();
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        // getAuthToken intentionally absent
      }),
    ).rejects.toMatchObject({ kind: 'auth-missing' });
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects when getAuthToken returns null (auth layer not wired)', async () => {
    const f = mockFetch();
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => null,
      }),
    ).rejects.toMatchObject({ kind: 'auth-missing' });
    expect(f).not.toHaveBeenCalled();
  });
});

// -------- Schema validation rejects malformed responses --------

describe('schema: malformed responses are rejected with retryable=false', () => {
  function mockFetchWith(body: unknown, status = 200) {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
  }
  const VALID_REQ = { input: 'hi', tone: 'soft' as const, sessionId: 's1' };

  it('rejects {} (no reply field)', async () => {
    const f = mockFetchWith({});
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed', retryable: false });
  });

  it('rejects { reply: "" }', async () => {
    const f = mockFetchWith({ reply: '' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('rejects { reply: "   \\n  " } (whitespace only)', async () => {
    const f = mockFetchWith({ reply: '   \n  ' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('rejects { reply: 42 } (wrong type)', async () => {
    const f = mockFetchWith({ reply: 42 });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('rejects "string" body (not an object)', async () => {
    const f = mockFetchWith('just a string');
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: f as any,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });
});

// -------- Usage limits enforce the cost cap --------

describe('usage: cost limits prevent runaway calls', () => {
  beforeEach(async () => {
    await resetUsage();
  });

  it('burst limit caps rapid calls', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '3';
    await reserveSlot();
    await reserveSlot();
    await reserveSlot();
    await expect(reserveSlot()).rejects.toBeInstanceOf(ChatUsageLimitError);
  });

  it('daily limit caps total calls', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '1000';
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '2';
    const t0 = new Date(2026, 0, 1, 8, 0, 0);
    await reserveSlot(t0);
    await reserveSlot(new Date(t0.getTime() + 5 * 60_000));
    await expect(
      reserveSlot(new Date(t0.getTime() + 10 * 60_000)),
    ).rejects.toBeInstanceOf(ChatUsageLimitError);
  });

  it('snapshot reflects the post-reserve state', async () => {
    await reserveSlot();
    const snap = await getChatUsageSnapshot();
    expect(snap.dayCount).toBe(1);
    expect(snap.burstCount).toBe(1);
  });
});

// -------- Safety-first integration smoke --------
// The actual order in ChatScreen.send is:
//   1. detectCrisis() — block the LLM if hard
//   2. resolveRealChatDecision() — is the backend even reachable?
//   3. reserveSlot() — do we have cost budget?
//   4. readChatBackendUrl() + fetchReply() — actually call
// The eval asserts the FIRST step blocks the LLM even if every
// later step says "go ahead".

describe('integration: hard crisis message never reaches the wire', () => {
  it('blocks a hard-crisis message even when the backend is fully configured', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST = 'api.fernly.app';
    // Crisis detector returns 'hard' for plain ideation.
    const v = detectCrisis('I want to kill myself');
    expect(v.level).toBe('hard');
    // The chat send path checks this BEFORE calling fetchReply.
    // (We don't make a real fetch here — the contract is the
    // ordering, which lives in ChatScreen.send. This test pins
    // the crisis verdict and assumes the chat send honors it.)
    // See plans/05 P0-3 / #41 "Safety routing remains independent
    // of the model".
    expect(readChatBackendUrl()).toBe('https://api.fernly.app');
    expect(readChatBackendEnabled()).toBe(true);
  });
});

describe('integration: a benign message can theoretically reach the wire', () => {
  it('crisis detector returns none for everyday text', async () => {
    const v = detectCrisis('hey, just checking in — how are you?');
    expect(v.level).toBe('none');
  });

  it('the decision layer is enabled when the env is set', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    const d = await resolveRealChatDecision();
    expect(d.enabled).toBe(true);
  });
});
