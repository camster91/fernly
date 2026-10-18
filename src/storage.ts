// Storage layer — typed, namespaced, schema-versioned.
//
// v0.2 partitioning:
//   AsyncStorage (unencrypted):
//     - profile (low sensitivity)
//     - moods (date + 1-6 score; mood journal content is privacy-sensitive
//       in aggregate but a single entry without chat context is moderate)
//     - onboarding-complete flag
//     - exercise sessions
//     - active-chat-session-id (just a UUID, no content)
//
//   expo-secure-store (encrypted, device-unlock-gated, no iCloud backup):
//     - chats (full chat history — includes crisis-flagged user text)
//     - crisis-audit (separate, write-only log; survives clearAll)
//
// v0.3 chat rewrite:
//   - Chat history is stored per-session under keyed SecureStore entries
//     (`fernly.session.<id>`) instead of a single array under one key.
//   - The active session id lives in AsyncStorage (UUID, no content).
//   - Message cap: 200 messages per session. Older messages get dropped
//     on append (FIFO) to bound storage growth.
//   - `appendMessageToSession` does an in-place read-modify-write of
//     a single session; no full-array JSON parse/stringify on each send.
//
// Why the split:
//   - Mood entries and profile are useful across devices and don't carry
//     crisis-flagged text — AsyncStorage is fine.
//   - Chat history includes the user's literal "kms rn" / "I want to
//     die" / etc. — that needs device-only encryption.
//   - The crisis audit log is for incident response (v1 work, not used
//     yet) and must NOT be wipeable by the user via Profile → Reset.
//
// All encrypted items get a `version` field so future schema changes
// can read old shapes gracefully.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { UserProfile, MoodEntry, ChatSession, ChatMessage, CrisisAuditEntry } from './types';

// ---- Constants ----
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CRISIS_AUDIT_ENTRIES = 500;

// ---- Reset event bus ----
// RootNav needs to re-read onboarded state after clearAll() because its
// mount useEffect has [] deps and only runs on first render. The custom
// event lets RootNav subscribe to resets without coupling to any specific
// screen. Storage layer emits, RootNav subscribes.
//
// This is a tiny pub-sub — one event ('reset') — instead of pulling in
// an event emitter library. v1 can replace with a proper state library
// (zustand, etc.) if more cross-screen coordination is needed.
type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();
export function onStorageReset(listener: ResetListener): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}
function emitReset() {
  for (const fn of resetListeners) {
    try {
      fn();
    } catch {
      /* swallow listener errors so one bad listener doesn't block others */
    }
  }
}

// ---- AsyncStorage keys (unencrypted) ----
const ASYNC_KEYS = {
  profile: '@fernly/profile',
  moods: '@fernly/moods',
  onboarding: '@fernly/onboarding-complete',
  activeSessionId: '@fernly/active-session-id',
  // v0.6: list of all per-session SecureStore keys that ever held chat
  // history for this install. AsyncStorage-only (low-sensitivity). Used
  // by clearAll() to enumerate and delete every per-session key, since
  // SecureStore has no list API.
  sessionKeyIndex: '@fernly/session-key-index',
  // v0.8 (F-P1-10): per-URL lastVerifiedAt (ms epoch) for crisis resources.
  // Seeded by `safety/crisis.ts` after a successful HEAD check; consumed at
  // app startup to short-circuit the "~3s unavailable banner" flash on cold
  // launch. Entries older than 6h are dropped on read; persistence is
  // best-effort (same swallow-on-error policy as the rest of AsyncStorage).
  verifiedUrls: '@fernly/verified-urls',
} as const;

// ---- SecureStore keys (encrypted, device-bound) ----
// WHEN_UNLOCKED_THIS_DEVICE_ONLY:
//   - Requires the device to be unlocked to read
//   - NOT included in iCloud Keychain / device backups
//   - Deleted if the user removes their passcode
// This is the right accessibility level for crisis-flagged content.
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const SECURE_KEYS = {
  // Legacy single-blob key — read for migration, then ignored.
  chats: 'fernly.chats.v1',
  crisisAudit: 'fernly.crisis-audit.v1',
} as const;

// Per-session key prefix. Each ChatSession lives under its own key so
// in-place appends don't re-serialize the entire history.
const SESSION_KEY_PREFIX = 'fernly.session.v1.';

// ---- Schema migration helpers ----
const CURRENT_CHAT_VERSION = 1 as const;

function migrateChatSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ChatSession> & { id?: unknown; messages?: unknown };
  if (typeof s.id !== 'string' || !Array.isArray(s.messages)) return null;
  const messages = s.messages.filter(
    (m): m is ChatMessage =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as ChatMessage).id === 'string' &&
      ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'fernly') &&
      typeof (m as ChatMessage).text === 'string' &&
      typeof (m as ChatMessage).at === 'string',
  );
  return {
    id: s.id,
    startedAt: typeof s.startedAt === 'string' ? s.startedAt : new Date().toISOString(),
    version: CURRENT_CHAT_VERSION,
    messages,
  };
}

function migrateCrisisAuditEntry(raw: unknown): CrisisAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<CrisisAuditEntry>;
  if (typeof e.id !== 'string' || typeof e.at !== 'string') return null;
  if (e.severity !== 'soft' && e.severity !== 'hard') return null;
  return {
    version: 1,
    id: e.id,
    at: e.at,
    severity: e.severity,
    matchedPhrase: typeof e.matchedPhrase === 'string' ? e.matchedPhrase : undefined,
    locale: typeof e.locale === 'string' ? e.locale : undefined,
  };
}

// ---- AsyncStorage I/O ----
async function asyncGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function asyncSet(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // intentionally swallow — caller should not crash on quota / IO errors
  }
}

async function asyncGetString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function asyncSetString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // swallow
  }
}

// ---- SecureStore I/O ----
async function secureGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, SECURE_OPTIONS);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value), SECURE_OPTIONS);
  } catch {
    // Swallow per-write errors. Audit-log writes (appendCrisisAudit) are
    // fire-and-forget by design.
    //
    // Callers that need to detect a failed write should use
    // secureSetStrict below: setChatSession (so a lost message is
    // reported) and the getChats() legacy migration (which must not
    // delete the legacy blob until every per-session key exists).
  }
}

async function secureSetStrict(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value), SECURE_OPTIONS);
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
  } catch {
    // swallow
  }
}

function sessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

// ---- Session index maintenance ----
// SecureStore has no list API, so we maintain an AsyncStorage index of
// every per-session key we've ever written. clearAll() reads this index
// to enumerate and delete every chat session. Without this, "Reset Fernly"
// would leave encrypted chat history (including crisis-flagged entries)
// in the device keychain.
//
// Centralized here so every write path (createChatSession,
// setChatSession, appendMessageToSession, addChat, legacy migration)
// updates the same index. setChatSession is the single funnel — any
// code that writes a session must go through it.
async function readSessionIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(ASYNC_KEYS.sessionKeyIndex);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function writeSessionIndex(list: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(ASYNC_KEYS.sessionKeyIndex, JSON.stringify(list));
  } catch {
    // best-effort — index is just a hint for clearAll; missing entries
    // become orphaned in the keychain but are unreachable without the id.
  }
}

// Serial append — Promise.all would race on readSessionIndex() since
// each call returns the same base list before either writes its update.
// Sequential is fine here: migration is rare and the session count is
// small (typically <10).
async function addToSessionIndexBatch(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const list = await readSessionIndex();
  for (const key of keys) {
    if (!list.includes(key)) list.push(key);
  }
  await writeSessionIndex(list);
}

async function addToSessionIndex(key: string): Promise<void> {
  await addToSessionIndexBatch([key]);
}

// ---- Public API ----
export const storage = {
  // --- Profile (unencrypted AsyncStorage) ---
  async getProfile(): Promise<UserProfile | null> {
    return asyncGet<UserProfile>(ASYNC_KEYS.profile);
  },
  async setProfile(p: UserProfile) {
    await asyncSet(ASYNC_KEYS.profile, p);
  },

  // --- Moods (unencrypted AsyncStorage) ---
  async getMoods(): Promise<MoodEntry[]> {
    return (await asyncGet<MoodEntry[]>(ASYNC_KEYS.moods)) ?? [];
  },
  async addMood(m: MoodEntry) {
    const all = await storage.getMoods();
    const filtered = all.filter((x) => x.date !== m.date);
    await asyncSet(ASYNC_KEYS.moods, [m, ...filtered]);
  },

  // --- Onboarding flag (unencrypted AsyncStorage) ---
  async getOnboarded(): Promise<boolean> {
    return (await AsyncStorage.getItem(ASYNC_KEYS.onboarding)) === 'true';
  },
  async setOnboarded(v: boolean) {
    try {
      await AsyncStorage.setItem(ASYNC_KEYS.onboarding, v ? 'true' : 'false');
    } catch {
      // swallow
    }
  },

  // --- Active session id (unencrypted AsyncStorage — UUID only) ---
  // v0.3: tracks which session is "current" so the chat screen can resume
  // it on next launch without re-listing all sessions.
  async getActiveSessionId(): Promise<string | null> {
    return asyncGetString(ASYNC_KEYS.activeSessionId);
  },
  async setActiveSessionId(id: string | null) {
    if (id === null) {
      try {
        await AsyncStorage.removeItem(ASYNC_KEYS.activeSessionId);
      } catch {
        // swallow
      }
    } else {
      await asyncSetString(ASYNC_KEYS.activeSessionId, id);
    }
  },

  // --- Verified crisis-resource URLs (unencrypted AsyncStorage) ---
  // v0.8 (F-P1-10): { url: lastVerifiedAt (ms epoch) }. Loaded at app
  // startup by `safety/crisis.ts`; entries <6h old are treated as fresh
  // and skipped during the post-launch re-check so the CrisisModal banner
  // doesn't flash "resources may be unavailable" for ~3s on every cold
  // launch.
  //
  // Returns {} on parse failure or missing key — callers treat the empty
  // shape as "nothing is fresh" and proceed with a full re-check.
  async getVerifiedUrls(): Promise<Record<string, number>> {
    return (await asyncGet<Record<string, number>>(ASYNC_KEYS.verifiedUrls)) ?? {};
  },

  async setVerifiedUrls(map: Record<string, number>) {
    await asyncSet(ASYNC_KEYS.verifiedUrls, map);
  },

  // --- Chat history: per-session keys (ENCRYPTED SecureStore) ---
  // v0.3: each session lives under its own SecureStore key so an in-place
  // append doesn't re-serialize the full chat history. The legacy single
  // blob under SECURE_KEYS.chats is read once on first getChatSession()
  // call (if no active session id is set) for backward compatibility,
  // then the resulting sessions are migrated to per-session keys.

  // Get a single chat session by id.
  async getChatSession(id: string): Promise<ChatSession | null> {
    const raw = await secureGet<unknown>(sessionKey(id));
    if (!raw) return null;
    return migrateChatSession(raw);
  },

  // Write/replace a single chat session. The caller passes the full
  // session; storage serializes the whole thing and records the key
  // in the reset index. This is the SINGLE funnel for writing chat
  // sessions — every other write path delegates here so the index
  // stays in sync.
  //
  // Strict write: a failed keychain write rejects, so callers see the
  // failure instead of the write silently vanishing.
  async setChatSession(session: ChatSession): Promise<void> {
    const next = { ...session, version: CURRENT_CHAT_VERSION };
    await secureSetStrict(sessionKey(session.id), next);
    await addToSessionIndex(sessionKey(session.id));
  },

  // Append a message to an existing session. In-place: reads the session,
  // appends (capped at MAX_MESSAGES_PER_SESSION, FIFO drop), writes back.
  // Returns the updated session, or null if the session didn't exist.
  async appendMessageToSession(
    sessionId: string,
    message: ChatMessage,
  ): Promise<ChatSession | null> {
    const session = await storage.getChatSession(sessionId);
    if (!session) return null;
    const next: ChatSession = {
      ...session,
      version: CURRENT_CHAT_VERSION,
      messages: [...session.messages, message].slice(-MAX_MESSAGES_PER_SESSION),
    };
    // Goes through setChatSession so the index stays in sync. This means
    // a session created via the legacy addChat path is still reachable
    // by clearAll() after a subsequent append.
    await storage.setChatSession(next);
    return next;
  },

  // Create a new session, write it under its own key, and set it as
  // active. Returns the new session.
  async createChatSession(initialMessages: ChatMessage[] = []): Promise<ChatSession> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: ChatSession = {
      id,
      startedAt: new Date().toISOString(),
      version: CURRENT_CHAT_VERSION,
      messages: initialMessages.slice(-MAX_MESSAGES_PER_SESSION),
    };
    // Goes through setChatSession so the index is updated.
    await storage.setChatSession(session);
    await storage.setActiveSessionId(id);
    return session;
  },

  // Legacy list-all-chats API. v0.3: this is only useful for the
  // ProfileScreen stats counter. Walks the legacy single-blob key
  // (if present) for v0 users and counts entries.
  async getChats(): Promise<ChatSession[]> {
    // Try the legacy blob first (v0 / v0.2 stored everything under one key).
    const raw = await secureGet<unknown[]>(SECURE_KEYS.chats);
    if (raw && Array.isArray(raw)) {
      const sessions = raw.map(migrateChatSession).filter((s): s is ChatSession => s !== null);
      // Migrate into per-session keys. setChatSession now also records
      // each key in the reset index, so the migrated sessions are
      // reachable by clearAll().
      //
      // Two-phase: write per-session keys FIRST, only delete the legacy
      // blob if all writes succeed. If a write fails, the legacy blob
      // stays so the migration can be retried (e.g. quota exceeded
      // recovery) rather than silently losing the user's chat history.
      // We use secureSetStrict (non-swallowing) so Promise.allSettled
      // can distinguish real failures from successful writes — the
      // regular secureSet swallows errors at the per-call level.
      const results = await Promise.allSettled(
        sessions.map((s) =>
          secureSetStrict(sessionKey(s.id), { ...s, version: CURRENT_CHAT_VERSION }),
        ),
      );
      const allOk = results.every((r) => r.status === 'fulfilled');
      if (allOk) {
        // Add all keys to the index BEFORE deleting the legacy blob,
        // so clearAll() can find them. addToSessionIndexBatch is serial
        // (not Promise.all) to avoid the read-modify-write race.
        await addToSessionIndexBatch(sessions.map((s) => sessionKey(s.id)));
        await secureDelete(SECURE_KEYS.chats);
      }
      return sessions;
    }
    // v0.3+: callers should prefer getChatSession(activeId). This list
    // path is here for the profile stats counter — it walks session keys
    // by attempting to read each candidate, but we don't track index.
    // The ProfileScreen currently shows `chats.length` from getChats();
    // in v0.3 we return [] and let the stats counter use the active
    // session only.
    return [];
  },

  // Every chat session on this install: runs the legacy migration, then
  // reads each key in the session index. Used by data export and the
  // profile stats counter (getChats() alone returns [] after migration).
  //
  // If the legacy migration fails, getChats() still returns the legacy
  // sessions (the blob is kept) but they aren't indexed yet, so merge them in.
  async getAllChatSessions(): Promise<ChatSession[]> {
    const legacy = await storage.getChats();
    const keys = await readSessionIndex();
    const indexed = await Promise.all(
      keys
        .filter((k) => k.startsWith(SESSION_KEY_PREFIX))
        .map((k) => storage.getChatSession(k.slice(SESSION_KEY_PREFIX.length))),
    );
    const byId = new Map<string, ChatSession>();
    for (const s of legacy) byId.set(s.id, s);
    for (const s of indexed) if (s) byId.set(s.id, s);
    return [...byId.values()];
  },

  // Legacy single-blob addChat: re-implemented as setChatSession +
  // setActiveSessionId for backward compatibility with callers that don't
  // yet use the v0.3 active-session pattern. setChatSession updates the
  // reset index, so this path is reachable by clearAll().
  async addChat(s: ChatSession) {
    await storage.setChatSession(s);
    await storage.setActiveSessionId(s.id);
  },

  // --- Crisis audit log (ENCRYPTED SecureStore, survives clearAll) ---
  async getCrisisAudit(): Promise<CrisisAuditEntry[]> {
    const raw = await secureGet<unknown[]>(SECURE_KEYS.crisisAudit);
    if (!raw) return [];
    return raw.map(migrateCrisisAuditEntry).filter((e): e is CrisisAuditEntry => e !== null);
  },
  async appendCrisisAudit(entry: CrisisAuditEntry) {
    const all = await storage.getCrisisAudit();
    const next = { ...entry, version: 1 as const };
    // FIFO cap at MAX_CRISIS_AUDIT_ENTRIES. A heavy user triggering
    // soft matches (e.g. "tired of being tired") over months could
    // otherwise accumulate unlimited audit entries. The audit log
    // survives clearAll by design, so without a cap storage grows
    // unbounded across the lifetime of the install.
    const capped = [next, ...all].slice(0, MAX_CRISIS_AUDIT_ENTRIES);
    await secureSet(SECURE_KEYS.crisisAudit, capped);
  },

  // --- Reset (wipes user-facing data; audit log persists) ---
  // v0.7: critical ordering — the session key index in AsyncStorage
  // MUST be read BEFORE removeMany() is called, otherwise removeMany
  // wipes the index itself and we can no longer enumerate the per-
  // session SecureStore keys to delete. Previously, the read happened
  // AFTER removeMany, so the index was gone, the catch swallowed the
  // JSON.parse(null) error, and Promise.allSettled([]) deleted nothing.
  // Result: "Reset Fernly" left encrypted chat history in the keychain
  // (including any crisis-flagged entries), defeating the privacy
  // promise.
  //
  // Fix: read the index first, then removeMany the rest of AsyncStorage
  // (including the now-redundant index itself last), then enumerate the
  // session keys from the saved list.
  async clearAll() {
    // 1. Snapshot the session key index BEFORE wiping AsyncStorage.
    const sessionKeys = await readSessionIndex();

    // 2. Wipe AsyncStorage keys EXCEPT the session index, which we still
    // need for the enumeration below.
    //
    // AsyncStorage v2 (which expo install --fix rolled us back to) doesn't
    // ship a batched `removeMany` API. Fall back to parallel removeItem
    // calls — same correctness, just N round-trips instead of one. The
    // session index is filtered out so we can read it in step 1 above
    // and then drop it last in step 5.
    const keysToRemove = Object.values(ASYNC_KEYS).filter((k) => k !== ASYNC_KEYS.sessionKeyIndex);
    try {
      await Promise.all(keysToRemove.map((k) => AsyncStorage.removeItem(k).catch(() => undefined)));
    } catch {
      // continue — best-effort wipe
    }

    // 3. Wipe the legacy single-blob key if it still exists.
    await secureDelete(SECURE_KEYS.chats);

    // 4. Enumerate and delete every per-session SecureStore key. Use
    // allSettled so a single failure (e.g. keychain locked mid-reset)
    // doesn't block the rest.
    const results = await Promise.allSettled(
      sessionKeys.map((k) => SecureStore.deleteItemAsync(k, SECURE_OPTIONS)),
    );
    const failedKeys = sessionKeys.filter((_, i) => results[i].status === 'rejected');

    // 5. Drop the drained session key index — but keep any key whose delete
    // failed, so a retry can still find it. Dropping it would orphan that
    // chat in the keychain for good.
    if (failedKeys.length > 0) {
      await writeSessionIndex(failedKeys);
    } else {
      try {
        await AsyncStorage.removeItem(ASYNC_KEYS.sessionKeyIndex);
      } catch {
        // ignore
      }
    }

    // NOTE: SECURE_KEYS.crisisAudit is intentionally NOT deleted here.
    //
    // Notify subscribers (RootNav) that a reset happened so they can
    // re-read state. This runs even if the AsyncStorage removeMany
    // above partially failed — the partial-failure case is rare but
    // we want listeners to know we attempted a reset.
    emitReset();

    // Surface partial failure so ProfileScreen can tell the user that chat
    // history is still on the device, instead of claiming success.
    if (failedKeys.length > 0) {
      throw new Error(`Reset could not delete ${failedKeys.length} chat session(s)`);
    }
  },
};
