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
    const originalRm = asyncStorage.removeItem.getMockImplementation();
    const originalRmMany = asyncStorage.removeMany.getMockImplementation();
    asyncStorage.getItem.mockImplementation(async (k: string) => {
      log.push({ op: 'get', key: k });
      return originalGet ? originalGet(k) : null;
    });
    asyncStorage.removeItem.mockImplementation(async (k: string) => {
      log.push({ op: 'rm', key: k });
      return originalRm ? originalRm(k) : undefined;
    });
    asyncStorage.removeMany.mockImplementation(async (ks: string[]) => {
      log.push({ op: 'rmMany', key: ks.join(',') });
      return originalRmMany ? originalRmMany(ks) : undefined;
    });

    await storage.clearAll();

    // 1. removeMany must NOT contain the session index.
    const rmMany = log.find((e) => e.op === 'rmMany');
    expect(rmMany).toBeDefined();
    expect(rmMany?.key).not.toContain(SESSION_INDEX);

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
