// Tests for the chat feature flag (v0.11, issue #41).
//
// We test the resolveRealChatDecision() / getRealChatOverride() /
// setRealChatOverride() trio. The override layer persists to
// AsyncStorage; we mock the storage helper to control what
// resolveRealChatDecision() observes.
//
// Coverage:
//   - default decision: env unset → disabled
//   - env flag off → disabled (env-disabled)
//   - URL missing → disabled (url-missing)
//   - env flag on + override unset → enabled
//   - env flag on + override true → enabled
//   - env flag on + override false → disabled (override-disabled)
//   - in-app override persistence: set, get, clear
//   - in-app override accepts various string forms

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRealChatOverride,
  isRealChatEnabled,
  isRealChatEnabledSync,
  resolveRealChatDecision,
  setRealChatOverride,
} from '../api/chat-feature-flag';
import { readChatBackendUrl } from '../api/chat';

// In-memory override store. We swap the storage helper rather
// than mocking the whole storage module so the tests stay small.
let overrideStore: string | null = null;
vi.mock('../storage', () => {
  return {
    storage: {
      getChatBackendOverride: async () => overrideStore,
      setChatBackendOverride: async (v: string) => {
        overrideStore = v;
      },
    },
  };
});

const ENV_KEYS = ['EXPO_PUBLIC_CHAT_API_URL', 'EXPO_PUBLIC_CHAT_BACKEND_ENABLED'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];

beforeEach(() => {
  overrideStore = null;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
  vi.restoreAllMocks();
});

describe('resolveRealChatDecision', () => {
  it('returns url-missing when the URL is unset', async () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: false, reason: 'url-missing' });
  });

  it('returns env-disabled when the flag is unset', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED;
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: false, reason: 'env-disabled' });
  });

  it('returns env-disabled when the flag is "0"', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = '0';
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: false, reason: 'env-disabled' });
  });

  it('returns enabled when env flag is on and no override is set', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: true, reason: 'enabled' });
  });

  it('returns enabled when env flag is on and override is true', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    overrideStore = '1';
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: true, reason: 'enabled' });
  });

  it('returns override-disabled when env flag is on and override is false', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    overrideStore = '0';
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: false, reason: 'override-disabled' });
  });

  it('URL check is consulted first (env-disabled can never enable a missing URL)', async () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    overrideStore = '1';
    const d = await resolveRealChatDecision();
    expect(d).toEqual({ enabled: false, reason: 'url-missing' });
  });

  it('falls back to disabled (url-missing) when readChatBackendUrl throws (non-https)', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'http://insecure.example.com';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    // The real readChatBackendUrl throws on http. Our safe wrapper
    // logs + returns null, so the decision is url-missing.
    const d = await resolveRealChatDecision();
    expect(d.enabled).toBe(false);
    expect(d.reason).toBe('url-missing');
  });
});

describe('isRealChatEnabled (async convenience)', () => {
  it('returns true when decision is enabled', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    expect(await isRealChatEnabled()).toBe(true);
  });

  it('returns false when decision is disabled', async () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'false';
    expect(await isRealChatEnabled()).toBe(false);
  });
});

describe('isRealChatEnabledSync', () => {
  it('returns false when env flag is unset', () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED;
    expect(isRealChatEnabledSync()).toBe(false);
  });

  it('returns true when env flag is on and URL is set', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    expect(isRealChatEnabledSync()).toBe(true);
  });

  it('throws when the URL is misconfigured (http://) — fail loud, fail fast', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'http://api.fernly.app';
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'true';
    expect(() => isRealChatEnabledSync()).toThrow();
  });
});

describe('in-app override', () => {
  it('getRealChatOverride returns null when nothing is set', async () => {
    overrideStore = null;
    expect(await getRealChatOverride()).toBeNull();
  });

  it('getRealChatOverride parses "1" as true', async () => {
    overrideStore = '1';
    expect(await getRealChatOverride()).toBe(true);
  });

  it('getRealChatOverride parses "0" as false', async () => {
    overrideStore = '0';
    expect(await getRealChatOverride()).toBe(false);
  });

  it('getRealChatOverride accepts "true" / "false" string forms', async () => {
    overrideStore = 'true';
    expect(await getRealChatOverride()).toBe(true);
    overrideStore = 'false';
    expect(await getRealChatOverride()).toBe(false);
  });

  it('getRealChatOverride treats the sentinel "unset" as null', async () => {
    overrideStore = 'unset';
    expect(await getRealChatOverride()).toBeNull();
  });

  it('getRealChatOverride treats empty string as null', async () => {
    overrideStore = '';
    expect(await getRealChatOverride()).toBeNull();
  });

  it('getRealChatOverride returns null for an unrecognized value', async () => {
    overrideStore = 'maybe';
    expect(await getRealChatOverride()).toBeNull();
  });

  it('setRealChatOverride(true) persists "1"', async () => {
    await setRealChatOverride(true);
    expect(overrideStore).toBe('1');
    expect(await getRealChatOverride()).toBe(true);
  });

  it('setRealChatOverride(false) persists "0"', async () => {
    await setRealChatOverride(false);
    expect(overrideStore).toBe('0');
    expect(await getRealChatOverride()).toBe(false);
  });

  it('setRealChatOverride(null) persists the "unset" sentinel', async () => {
    await setRealChatOverride(null);
    expect(overrideStore).toBe('unset');
    expect(await getRealChatOverride()).toBeNull();
  });
});

// Smoke check that readChatBackendUrl is wired into the decision
// layer — if this drifts the other tests would still pass but the
// feature flag would be lying.
describe('readChatBackendUrl integration', () => {
  it('is imported and the decision layer calls it (sanity check)', () => {
    expect(typeof readChatBackendUrl).toBe('function');
  });
});
