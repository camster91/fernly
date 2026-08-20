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

// v0.10 (issue #79): the result-returning profile/moods reads must
// distinguish a legitimate empty state from a read failure so the
// calling screen doesn't route a returning user into onboarding or
// render an empty chart + 0-day streak when their data is intact.
describe('safe reads (issue #79)', () => {
  const PROFILE_KEY = '@fernly/profile';
  const MOODS_KEY = '@fernly/moods';

  function validProfile() {
    return {
      name: 'Test',
      mascot: 'moon',
      tone: 'soft',
      goals: [],
      onboarded: true,
      createdAt: '2026-07-21T12:00:00.000Z',
    };
  }

  it('getProfileSafe returns empty for a fresh install', async () => {
    expect(await storage.getProfileSafe()).toEqual({ kind: 'empty' });
  });

  it('getProfileSafe returns ready with the parsed profile', async () => {
    asyncData.set(PROFILE_KEY, JSON.stringify(validProfile()));
    const result = await storage.getProfileSafe();
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') {
      expect(result.profile.name).toBe('Test');
    }
  });

  it('getProfileSafe returns error for malformed JSON', async () => {
    asyncData.set(PROFILE_KEY, '{not json');
    const result = await storage.getProfileSafe();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      // The exact reason comes from JSON.parse; just assert non-empty
      // so we don't pin to a specific V8 message.
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('getProfileSafe returns error when AsyncStorage throws', async () => {
    asyncStorage.getItem.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    const result = await storage.getProfileSafe();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('disk full');
    }
  });

  it('getProfileSafe returns error when the record is the wrong shape', async () => {
    asyncData.set(PROFILE_KEY, JSON.stringify({ not: 'a profile' }));
    const result = await storage.getProfileSafe();
    expect(result.kind).toBe('error');
  });

  it('getMoodsSafe returns empty for a fresh install', async () => {
    expect(await storage.getMoodsSafe()).toEqual({ kind: 'empty' });
  });

  it('getMoodsSafe returns ready with the parsed array', async () => {
    asyncData.set(MOODS_KEY, JSON.stringify([{ date: '2026-07-21', score: 4 }]));
    const result = await storage.getMoodsSafe();
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') {
      expect(result.moods).toHaveLength(1);
    }
  });

  it('getMoodsSafe returns error when the record is malformed', async () => {
    asyncData.set(MOODS_KEY, '{not json');
    const result = await storage.getMoodsSafe();
    expect(result.kind).toBe('error');
  });

  it('getMoodsSafe returns error when AsyncStorage throws', async () => {
    asyncStorage.getItem.mockImplementationOnce(async () => {
      throw new Error('IO error');
    });
    const result = await storage.getMoodsSafe();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('IO error');
    }
  });

  it('getMoodsSafe returns error when the record is not an array', async () => {
    asyncData.set(MOODS_KEY, JSON.stringify({ not: 'array' }));
    const result = await storage.getMoodsSafe();
    expect(result.kind).toBe('error');
  });
});

// v0.10 (issue #52): the index-walking enumerator and the strict
// write APIs. The previous behavior collapsed multi-session installs
// into a single-session count (the legacy getChats() returned [] for
// v0.3+ users) and silently swallowed save failures, letting the
// onboarding screen mark the user "complete" without a successful
// write. These tests pin the new behavior.
describe('strict writes and session enumeration (issue #52)', () => {
  const PROFILE_KEY = '@fernly/profile';

  it('setProfileStrict throws on AsyncStorage failure', async () => {
    asyncStorage.setItem.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(
      storage.setProfileStrict({
        name: 'x',
        mascot: 'moon',
        tone: 'soft',
        goals: [],
        onboarded: true,
        createdAt: '2026-07-21T12:00:00.000Z',
      }),
    ).rejects.toThrow('quota exceeded');
  });

  it('addMoodStrict throws on AsyncStorage failure', async () => {
    asyncStorage.getItem.mockResolvedValueOnce(JSON.stringify([]));
    asyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      storage.addMoodStrict({ date: '2026-07-21', score: 4 }),
    ).rejects.toThrow('disk full');
  });

  it('setOnboardedStrict throws on AsyncStorage failure', async () => {
    asyncStorage.setItem.mockRejectedValueOnce(new Error('readonly'));
    await expect(storage.setOnboardedStrict(true)).rejects.toThrow('readonly');
  });

  it('getAllChatSessions returns every current session sorted newest-first', async () => {
    const old = { ...session('old-1'), startedAt: '2026-07-01T00:00:00.000Z' };
    const mid = { ...session('mid-2'), startedAt: '2026-07-15T00:00:00.000Z' };
    const fresh = { ...session('fresh-3'), startedAt: '2026-07-21T00:00:00.000Z' };
    await storage.setChatSession(old);
    await storage.setChatSession(mid);
    await storage.setChatSession(fresh);

    const { sessions, unreadable } = await storage.getAllChatSessions();

    expect(unreadable).toEqual([]);
    expect(sessions.map((s) => s.id)).toEqual(['fresh-3', 'mid-2', 'old-1']);
  });

  it('getAllChatSessions reports partial-failure keys without blocking the rest', async () => {
    await storage.setChatSession(session('good-1'));
    // Force a per-session read failure by stuffing a malformed value
    // under a second key. The walker uses Promise.allSettled so a
    // single failure is reported, not propagated.
    secureData.set(sessionKey('broken-2'), '{not json');
    await storage.setChatSession({ id: 'broken-2', startedAt: 'x', version: 1, messages: [] });
    // The second setChatSession overwrote the malformed value, so we
    // re-inject the malformed blob AFTER the write — this simulates a
    // session that was written then corrupted in the keychain.
    secureData.set(sessionKey('broken-2'), '{not json');
    await storage.setChatSession(session('good-3'));

    const { sessions, unreadable } = await storage.getAllChatSessions();

    expect(sessions.map((s) => s.id).sort()).toEqual(['good-1', 'good-3']);
    expect(unreadable).toContain(sessionKey('broken-2'));
  });

  it('getAllChatSessions migrates the legacy single-blob into per-session entries', async () => {
    const legacy = [
      { ...session('legacy-a'), startedAt: '2026-06-01T00:00:00.000Z' },
      { ...session('legacy-b'), startedAt: '2026-06-15T00:00:00.000Z' },
    ];
    secureData.set(LEGACY_CHATS, JSON.stringify(legacy));

    const { sessions, unreadable } = await storage.getAllChatSessions();

    expect(unreadable).toEqual([]);
    // The legacy blob is migrated into per-session keys and then
    // deleted. The enumerator should see both migrated sessions.
    expect(sessions.map((s) => s.id).sort()).toEqual(['legacy-a', 'legacy-b']);
    // Legacy blob is gone after migration.
    expect(secureData.has(LEGACY_CHATS)).toBe(false);
  });

  it('clearAll returns a result enumerating successful and failed deletes', async () => {
    const a = await storage.createChatSession([message('a')]);
    const b = await storage.createChatSession([message('b')]);

    // Make one of the session deletes fail so we can verify the
    // result distinguishes per-key outcomes.
    const realDelete = secureStore.deleteItemAsync.getMockImplementation();
    let callIndex = 0;
    secureStore.deleteItemAsync.mockImplementation(async (k: string) => {
      callIndex += 1;
      if (k === sessionKey(b.id)) {
        throw new Error('keychain locked');
      }
      return realDelete?.(k) ?? undefined;
    });

    const result = await storage.clearAll();

    expect(result.auditRetained).toBe(true);
    expect(result.legacyDeleted).toBe(true);
    // a deleted, b failed.
    expect(result.sessionsFailed).toContain(sessionKey(b.id));
    expect(result.sessionsFailed).not.toContain(sessionKey(a.id));
  });

  it('clearAll drops the session key index and AsyncStorage keys', async () => {
    await storage.createChatSession([message('one')]);
    asyncData.set(PROFILE_KEY, JSON.stringify({ name: 'x' }));

    const result = await storage.clearAll();

    expect(result.indexRemoved).toBe(true);
    expect(asyncData.has(PROFILE_KEY)).toBe(false);
    expect(asyncData.has(SESSION_INDEX)).toBe(false);
  });
});

// v0.10 (issue #56): partial-failure recovery, idempotency,
// and migration edge cases for the storage layer.
//
// The issue calls out: "Migration could orphan, duplicate, or
// delete data. Keep legacy/index representations until
// post-write verification and make recovery idempotent."
// These tests pin the recovery semantics so a future
// refactor doesn't accidentally regress the privacy promise
// (encrypted chat history surviving a "Reset Fernly").
describe('migration, idempotency, and recovery (issue #56)', () => {
  it('clearAll is idempotent — calling it twice is safe', async () => {
    await storage.createChatSession([message('one')]);
    await storage.clearAll();
    // Second call should not throw, and the index should
    // remain absent (no error from a missing-key remove).
    const result = await storage.clearAll();
    expect(result.asyncStorageRemoved).toBeGreaterThanOrEqual(0);
    expect(result.legacyDeleted).toBe(true);
    expect(result.sessionsDeleted).toBe(0);
    expect(result.sessionsFailed).toEqual([]);
    expect(result.indexRemoved).toBe(true);
  });

  it('getAllChatSessions is idempotent and stable across repeated calls', async () => {
    const a = await storage.createChatSession([message('a')]);
    const b = await storage.createChatSession([message('b')]);
    const first = await storage.getAllChatSessions();
    const second = await storage.getAllChatSessions();
    expect(first.sessions.map((s) => s.id)).toEqual(second.sessions.map((s) => s.id));
    expect(first.unreadable).toEqual(second.unreadable);
    expect(first.sessions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('a corrupt secureData key survives an enumeration without throwing', async () => {
    await storage.setChatSession(session('good'));
    // Stuff garbage under known-bad keys AND inject them into
    // the index, simulating a session that was written then
    // corrupted in the keychain (the index points at it but
    // the value is unreadable). The walker uses Promise.allSettled
    // so a per-key failure is reported, not propagated.
    asyncData.set(SESSION_INDEX, JSON.stringify([
      sessionKey('good'),
      sessionKey('bad-1'),
      sessionKey('bad-2'),
      sessionKey('good-2'),
    ]));
    secureData.set(sessionKey('bad-1'), '{not valid json');
    secureData.set(sessionKey('bad-2'), JSON.stringify({ not: 'a session' }));
    secureData.set(sessionKey('good-2'), JSON.stringify(session('good-2')));

    const { sessions, unreadable } = await storage.getAllChatSessions();
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['good', 'good-2'].sort());
    expect(unreadable).toContain(sessionKey('bad-1'));
    expect(unreadable).toContain(sessionKey('bad-2'));
  });

  it('appendMessageToSession on a session deleted mid-flight is safe', async () => {
    const s = await storage.createChatSession([message('original')]);
    // Simulate the session being deleted from under us (e.g. user
    // hit "Reset" while a chat-send was in flight). The append
    // should return null rather than re-create the session.
    await storage.deleteChatSession(s.id);
    const result = await storage.appendMessageToSession(s.id, message('late'));
    expect(result).toBeNull();
  });

  it('setChatSessionStrict throws and does NOT re-index on failure', async () => {
    // Inject a write failure on the next secureStore call.
    const realSet = secureStore.setItemAsync.getMockImplementation();
    secureStore.setItemAsync.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    await expect(
      storage.setChatSessionStrict(session('should-fail')),
    ).rejects.toThrow('disk full');
    // Restore the mock so the rest of the test can write
    // normally. The failed key must NOT be in the index.
    secureStore.setItemAsync.mockImplementation(realSet!);
    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).not.toContain(sessionKey('should-fail'));
  });

  it('legacy-blob migration: per-session write failure leaves the legacy blob intact', async () => {
    // Simulate a v0 install with a legacy single-blob that
    // contains two sessions. Inject a failure on the FIRST
    // per-session write so migration aborts mid-flight. The
    // legacy blob must remain in place so a retry on the
    // next launch can re-attempt the migration.
    const legacy = [
      { ...session('legacy-a'), startedAt: '2026-06-01T00:00:00.000Z' },
      { ...session('legacy-b'), startedAt: '2026-06-15T00:00:00.000Z' },
    ];
    secureData.set(LEGACY_CHATS, JSON.stringify(legacy));
    // First call to setItemAsync on a SESSION key (not the
    // legacy key) throws; subsequent calls succeed.
    const realSet = secureStore.setItemAsync.getMockImplementation();
    let sessionKeyWrites = 0;
    secureStore.setItemAsync.mockImplementation(async (key, value, options) => {
      if (key.startsWith('fernly.session.v1.')) {
        sessionKeyWrites += 1;
        if (sessionKeyWrites === 1) {
          throw new Error('transient I/O');
        }
      }
      return realSet!(key, value, options);
    });
    // getChats() is what the chat-screen mount calls; it
    // triggers the migration. The first per-session write
    // throws, which surfaces through the Promise.allSettled.
    await storage.getChats();
    // The legacy blob is still in place (migration aborts
    // partway, doesn't delete the legacy until ALL writes
    // succeed). The partially-migrated session is in
    // SecureStore but the legacy blob is preserved.
    expect(secureData.has(LEGACY_CHATS)).toBe(true);
  });
});

// v0.10 (issue #70): per-session delete used by the chat history
// sheet. Removes the session key, the index entry, and clears
// the active id if it pointed at the deleted session.
describe('single-session delete (issue #70)', () => {
  it('removes a session, the index entry, and clears the active pointer', async () => {
    const a = await storage.createChatSession([message('keep')]);
    const b = await storage.createChatSession([message('drop')]);

    const ok = await storage.deleteChatSession(b.id);

    expect(ok).toBe(true);
    expect(await storage.getChatSession(b.id)).toBeNull();
    expect(await storage.getChatSession(a.id)).not.toBeNull();
    // b was the active session (last created). deleteChatSession
    // clears the active pointer so the next chat mount doesn't
    // point at the deleted one. The user will land on a fresh
    // session; `a` is still in the index for them to switch to.
    expect(await storage.getActiveSessionId()).toBeNull();

    const index = JSON.parse(asyncData.get(SESSION_INDEX) ?? '[]');
    expect(index).toContain(sessionKey(a.id));
    expect(index).not.toContain(sessionKey(b.id));
  });

  it('returns false when the session id does not exist', async () => {
    const ok = await storage.deleteChatSession('does-not-exist');
    expect(ok).toBe(false);
  });

  it('clears the active id when the deleted session was active', async () => {
    const only = await storage.createChatSession([message('only')]);
    expect(await storage.getActiveSessionId()).toBe(only.id);
    await storage.deleteChatSession(only.id);
    expect(await storage.getActiveSessionId()).toBeNull();
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
