// Storage layer regression tests. Critical because:
//  - PR1 fixed a clearAll() race that left encrypted chat history in
//    SecureStore after "Reset Fernly". These tests pin the fix.
//  - The SecureStore migration (legacy blob -> per-session keys) must
//    survive partial-state failure. Migration tests cover that.
//  - Schema corruption (bad JSON, wrong shape) must not crash the
//    app. Recovery tests cover that.
//
// The native modules are mocked with in-memory Maps; both mocks
// track every call so we can assert on write/read ordering.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const asyncData = new Map<string, string>();
const secureData = new Map<string, string>();

const asyncStorage = {
  getItem: vi.fn(async (key: string) => asyncData.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    asyncData.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    asyncData.delete(key);
  }),
  removeMany: vi.fn(async (keys: string[]) => {
    keys.forEach((key) => asyncData.delete(key));
  }),
};

const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (key: string) => secureData.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureData.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureData.delete(key);
  }),
};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorage,
}));

vi.mock('expo-secure-store', () => secureStore);

// Dynamic import AFTER mocks so the module under test sees them.
const { storage, onStorageReset } = await import('../storage');

const ACTIVE_ID = '@fernly/active-session-id';
const SESSION_INDEX = '@fernly/session-key-index';
const LEGACY_CHATS = 'fernly.chats.v1';
const CRISIS_AUDIT = 'fernly.crisis-audit.v1';
const sessionKey = (id: string) => `fernly.session.v1.${id}`;

function message(id: string, text = id) {
  return {
    id,
    role: 'user' as const,
    text,
    at: '2026-07-21T12:00:00.000Z',
  };
}

function session(id: string, messages = [message(`${id}-m1`)]) {
  return {
    id,
    startedAt: '2026-07-21T12:00:00.000Z',
    version: 1 as const,
    messages,
  };
}

beforeEach(() => {
  asyncData.clear();
  secureData.clear();
  vi.clearAllMocks();
});

describe('first run and round trips', () => {
  it('returns null when no active session exists', async () => {
    expect(await storage.getActiveSessionId()).toBeNull();
  });

  it('returns null for a missing session without crashing', async () => {
    expect(await storage.getChatSession('missing')).toBeNull();
  });

  it('creates, activates, persists, and indexes a session', async () => {
    const created = await storage.createChatSession([message('first')]);

    expect(await storage.getActiveSessionId()).toBe(created.id);
    expect(await storage.getChatSession(created.id)).toEqual(created);

    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toContain(sessionKey(created.id));
  });

  it('setChatSession records the key in the reset index', async () => {
    await storage.setChatSession(session('s1'));

    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toContain(sessionKey('s1'));
  });

  it('appendMessageToSession keeps the session indexed', async () => {
    await storage.createChatSession();
    asyncData.delete(SESSION_INDEX); // simulate index loss
    await storage.setChatSession(session('s2'));
    // Index now has s2; append a message:
    await storage.appendMessageToSession('s2', message('appended'));

    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toContain(sessionKey('s2'));
  });

  it('addChat (legacy alias) updates the index', async () => {
    await storage.addChat(session('compat'));

    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toContain(sessionKey('compat'));
  });

  it('appends and preserves existing messages', async () => {
    await storage.setChatSession(session('s1'));
    const updated = await storage.appendMessageToSession('s1', message('second'));

    expect(updated?.messages.map((m) => m.id)).toEqual(['s1-m1', 'second']);
    expect((await storage.getChatSession('s1'))?.messages).toEqual(updated?.messages);
  });

  it('returns null when appending to a missing session', async () => {
    expect(await storage.appendMessageToSession('missing', message('new'))).toBeNull();
  });

  it('caps a session at 200 messages and drops oldest first', async () => {
    const initial = Array.from({ length: 200 }, (_, i) => message(`m-${i}`));
    await storage.setChatSession(session('capped', initial));

    const updated = await storage.appendMessageToSession('capped', message('m-200'));

    expect(updated?.messages).toHaveLength(200);
    expect(updated?.messages[0].id).toBe('m-1');
    expect(updated?.messages[199].id).toBe('m-200');
  });
});

describe('schema and corruption recovery', () => {
  it('returns null for corrupt per-session JSON', async () => {
    secureData.set(sessionKey('bad'), '{not json');
    expect(await storage.getChatSession('bad')).toBeNull();
  });

  it('rejects a malformed session shape', async () => {
    secureData.set(sessionKey('bad-shape'), JSON.stringify({ id: 123, messages: 'wrong' }));
    expect(await storage.getChatSession('bad-shape')).toBeNull();
  });

  it('normalizes legacy sessions and drops malformed messages', async () => {
    secureData.set(
      sessionKey('legacy-shape'),
      JSON.stringify({
        id: 'legacy-shape',
        messages: [
          message('valid'),
          null,
          { id: 'missing-fields' },
          { id: 'bad-role', role: 'other', text: 'x', at: 'now' },
        ],
      }),
    );

    const migrated = await storage.getChatSession('legacy-shape');

    expect(migrated?.version).toBe(1);
    expect(migrated?.messages.map((m) => m.id)).toEqual(['valid']);
  });
});

describe('legacy blob migration', () => {
  it('migrates valid legacy sessions, deletes legacy blob, and indexes new keys', async () => {
    const old = [session('legacy-a'), session('legacy-b')];
    secureData.set(LEGACY_CHATS, JSON.stringify(old));

    const migrated = await storage.getChats();

    expect(migrated.map((s) => s.id)).toEqual(['legacy-a', 'legacy-b']);
    expect(await storage.getChatSession('legacy-a')).toMatchObject({
      id: 'legacy-a',
      version: 1,
    });
    expect(await storage.getChatSession('legacy-b')).toMatchObject({
      id: 'legacy-b',
      version: 1,
    });
    expect(secureData.has(LEGACY_CHATS)).toBe(false);

    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toEqual(expect.arrayContaining([sessionKey('legacy-a'), sessionKey('legacy-b')]));
  });

  it('handles legacy and existing per-session data in the same store', async () => {
    secureData.set(LEGACY_CHATS, JSON.stringify([session('legacy')]));
    secureData.set(sessionKey('current'), JSON.stringify(session('current')));
    asyncData.set(ACTIVE_ID, 'current');

    await storage.getChats();

    expect(await storage.getChatSession('legacy')).not.toBeNull();
    expect(await storage.getChatSession('current')).not.toBeNull();
    expect(await storage.getActiveSessionId()).toBe('current');
    expect(secureData.has(LEGACY_CHATS)).toBe(false);
  });

  it('does not delete the legacy blob until all migration writes succeed', async () => {
    secureData.set(LEGACY_CHATS, JSON.stringify([session('legacy')]));
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('unavailable'));

    await storage.getChats();

    expect(secureData.has(LEGACY_CHATS)).toBe(true);
  });
});

describe('reset regression (PR1)', () => {
  it('deletes every indexed session key, active id, and legacy blob', async () => {
    const first = await storage.createChatSession([message('first')]);
    const second = await storage.createChatSession([message('second')]);
    secureData.set(LEGACY_CHATS, JSON.stringify([session('old')]));

    await storage.clearAll();

    expect(await storage.getActiveSessionId()).toBeNull();
    expect(await storage.getChatSession(first.id)).toBeNull();
    expect(await storage.getChatSession(second.id)).toBeNull();
    expect(secureData.has(LEGACY_CHATS)).toBe(false);
    expect(await storage.getChats()).toEqual([]);
    // Index itself is also cleared:
    expect(asyncData.has(SESSION_INDEX)).toBe(false);
  });

  it('reads the session index BEFORE removing it (PR1 fix)', async () => {
    await storage.createChatSession([message('one')]);

    // Reset mock counters before clearAll so we only measure the calls
    // made during clearAll itself.
    asyncStorage.getItem.mockClear();
    asyncStorage.removeItem.mockClear();
    asyncStorage.removeMany.mockClear();

    // Track a unified call log across all three mock methods so we can
    // assert global ordering (not just per-method).
    const log: Array<{ op: string; key: string }> = [];
    const originalGet = asyncStorage.getItem.getMockImplementation();
    const originalRemove = asyncStorage.removeItem.getMockImplementation();
    asyncStorage.getItem.mockImplementation(async (k: string) => {
      log.push({ op: 'get', key: k });
      return originalGet ? originalGet(k) : null;
    });
    asyncStorage.removeItem.mockImplementation(async (k: string) => {
      log.push({ op: 'rm', key: k });
      return originalRemove ? originalRemove(k) : undefined;
    });

    await storage.clearAll();

    // 1. None of the parallel removeItem calls (which replaced the
    //    AsyncStorage v3 removeMany) should target the session index —
    //    we filter it out so the read in step 1 can succeed first.
    const sessionIndexRemoves = log.filter((e) => e.op === 'rm' && e.key === SESSION_INDEX);
    // Allow at most ONE rm on sessionKeyIndex — the explicit step-5 drop.
    // The PR1 invariant: NO removeItem on sessionKeyIndex happens before
    // the getItem(sessionKeyIndex) read.
    expect(sessionIndexRemoves.length).toBeLessThanOrEqual(1);

    // 2. Find the position of the last get(SESSION_INDEX) and the first
    //    rm(SESSION_INDEX). The read MUST come before the remove.
    const lastGetPos = log
      .map((e, i) => (e.op === 'get' && e.key === SESSION_INDEX ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    const firstRmPos = log
      .map((e, i) => (e.op === 'rm' && e.key === SESSION_INDEX ? i : -1))
      .find((i) => i >= 0);

    expect(lastGetPos).toBeGreaterThanOrEqual(0);
    expect(firstRmPos).toBeGreaterThanOrEqual(0);
    expect(lastGetPos).toBeLessThan(firstRmPos!);
  });

  it('keeps the crisis audit while deleting user-facing data', async () => {
    secureData.set(CRISIS_AUDIT, JSON.stringify([]));
    await storage.createChatSession([message('private')]);

    await storage.clearAll();

    expect(secureData.has(CRISIS_AUDIT)).toBe(true);
  });

  it('emits exactly one reset event and supports unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = onStorageReset(listener);

    await storage.clearAll();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await storage.clearAll();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh session after reset', async () => {
    await storage.createChatSession([message('old')]);
    await storage.clearAll();

    const fresh = await storage.createChatSession([message('fresh')]);

    expect(await storage.getActiveSessionId()).toBe(fresh.id);
    expect(await storage.getChatSession(fresh.id)).toEqual(fresh);
  });
});

describe('crisis audit cap', () => {
  it('caps the audit log at MAX_CRISIS_AUDIT_ENTRIES (FIFO)', async () => {
    // Simulate 500 entries already present, oldest first.
    const existing = Array.from({ length: 500 }, (_, i) => ({
      version: 1 as const,
      id: `old-${i}`,
      at: '2026-07-21T00:00:00.000Z',
      severity: 'soft' as const,
      matchedPhrase: `phrase ${i}`,
    }));
    secureData.set(CRISIS_AUDIT, JSON.stringify(existing));

    await storage.appendCrisisAudit({
      version: 1,
      id: 'new',
      at: '2026-07-21T12:00:00.000Z',
      severity: 'hard',
      matchedPhrase: 'kms',
    });

    const after = await storage.getCrisisAudit();
    expect(after).toHaveLength(500);
    // New entry at the front (most recent).
    expect(after[0].id).toBe('new');
    // With 500 existing entries, [next, ...existing] = 501 items; slice(0,500)
    // drops the LAST of the original array, which was old-499. So old-499
    // is gone, old-0 through old-498 remain, and old-498 is the new oldest.
    expect(after[after.length - 1].id).toBe('old-498');
    expect(after.find((e) => e.id === 'old-499')).toBeUndefined();
  });
});

describe('reset: failed keychain deletes are surfaced, not hidden', () => {
  it('throws and keeps the failed key indexed so a retry can delete it', async () => {
    const kept = await storage.createChatSession([message('stuck')]);
    const gone = await storage.createChatSession([message('ok')]);
    secureStore.deleteItemAsync.mockImplementation(async (k: string) => {
      if (k === sessionKey(kept.id)) throw new Error('keychain locked');
      secureData.delete(k);
    });

    await expect(storage.clearAll()).rejects.toThrow(/1 chat session/);

    expect(await storage.getChatSession(gone.id)).toBeNull();
    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toEqual([sessionKey(kept.id)]);

    // Retry once the keychain is available again.
    secureStore.deleteItemAsync.mockImplementation(async (k: string) => {
      secureData.delete(k);
    });
    await storage.clearAll();
    expect(await storage.getChatSession(kept.id)).toBeNull();
    expect(asyncData.has(SESSION_INDEX)).toBe(false);
  });
});

describe('getAllChatSessions (export + stats)', () => {
  it('returns every indexed session, not just the active one', async () => {
    const a = await storage.createChatSession([message('a')]);
    const b = await storage.createChatSession([message('b')]);

    const all = await storage.getAllChatSessions();

    expect(all.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('includes sessions migrated from the legacy blob, once each', async () => {
    secureData.set(LEGACY_CHATS, JSON.stringify([session('legacy')]));

    const all = await storage.getAllChatSessions();

    expect(all.map((s) => s.id)).toEqual(['legacy']);
  });
});

describe('chat writes surface failures', () => {
  it('appendMessageToSession rejects when the secure write fails', async () => {
    const s = await storage.createChatSession();
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('value too large'));

    await expect(storage.appendMessageToSession(s.id, message('big'))).rejects.toThrow();
  });
});

describe('getAllChatSessions when legacy migration fails', () => {
  it('still returns the legacy sessions', async () => {
    secureData.set(LEGACY_CHATS, JSON.stringify([session('legacy-a'), session('legacy-b')]));
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('keychain locked'));

    const all = await storage.getAllChatSessions();

    expect(all.map((s) => s.id).sort()).toEqual(['legacy-a', 'legacy-b']);
    expect(secureData.has(LEGACY_CHATS)).toBe(true);
  });
});

describe('session completions', () => {
  const COMPLETIONS = '@fernly/session-completions';
  const completion = (n: number) => ({
    sessionId: `s${n}`,
    completedAt: '2026-10-18T12:00:00.000Z',
    seconds: n,
  });

  it('adds a completion and returns it newest first', async () => {
    await storage.addCompletion(completion(1));
    await storage.addCompletion(completion(2));
    expect(await storage.getCompletions()).toEqual([completion(2), completion(1)]);
    expect(asyncData.has(COMPLETIONS)).toBe(true);
  });

  it('caps at the newest 1,000 entries', async () => {
    const seed = Array.from({ length: 1000 }, (_, i) => completion(i + 1));
    asyncData.set(COMPLETIONS, JSON.stringify(seed));
    await storage.addCompletion(completion(5000));
    const all = await storage.getCompletions();
    expect(all).toHaveLength(1000);
    expect(all[0]).toEqual(completion(5000));
    expect(all[999]).toEqual(completion(999));
  });

  it('returns [] when the stored JSON is not an array', async () => {
    asyncData.set(COMPLETIONS, JSON.stringify({ not: 'an array' }));
    expect(await storage.getCompletions()).toEqual([]);
  });

  it('drops malformed entries on read', async () => {
    asyncData.set(
      COMPLETIONS,
      JSON.stringify([
        completion(1),
        null,
        'x',
        { sessionId: 1, completedAt: 'a', seconds: 1 },
        { sessionId: 'a', completedAt: 2, seconds: 1 },
        { sessionId: 'a', completedAt: 'a', seconds: -1 },
        { sessionId: 'a', completedAt: 'a', seconds: '5' },
        { sessionId: 'a', completedAt: 'a', seconds: null },
      ]),
    );
    expect(await storage.getCompletions()).toEqual([completion(1)]);
  });

  it('clearAll removes completions', async () => {
    await storage.addCompletion(completion(1));
    await storage.clearAll();
    expect(asyncData.has(COMPLETIONS)).toBe(false);
    expect(await storage.getCompletions()).toEqual([]);
  });
});
