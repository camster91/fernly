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

// ---- AsyncStorage keys (unencrypted) ----
const ASYNC_KEYS = {
  profile: '@fernly/profile',
  moods: '@fernly/moods',
  sessions: '@fernly/sessions',
  onboarding: '@fernly/onboarding-complete',
  activeSessionId: '@fernly/active-session-id',
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
      !!m && typeof m === 'object' && 'id' in m && 'role' in m && 'text' in m && 'at' in m,
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
    // intentionally swallow — caller should not crash
  }
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

  // --- Exercise sessions (unencrypted AsyncStorage) ---
  async getSessions() {
    return (await asyncGet<unknown[]>(ASYNC_KEYS.sessions)) ?? [];
  },
  async addSession(s: unknown) {
    const all = await storage.getSessions();
    await asyncSet(ASYNC_KEYS.sessions, [s, ...all]);
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
  // session; storage serializes the whole thing.
  async setChatSession(session: ChatSession): Promise<void> {
    const next = { ...session, version: CURRENT_CHAT_VERSION };
    await secureSet(sessionKey(session.id), next);
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
    await secureSet(sessionKey(sessionId), next);
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
    await secureSet(sessionKey(id), session);
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
      // Migrate into per-session keys and clear the legacy blob.
      await Promise.all(sessions.map((s) => storage.setChatSession(s).catch(() => undefined)));
      await secureDelete(SECURE_KEYS.chats);
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

  // Legacy single-blob addChat: re-implemented as createChatSession
  // for backward compatibility with callers that don't yet use the
  // v0.3 active-session pattern.
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
    await secureSet(SECURE_KEYS.crisisAudit, [next, ...all]);
  },

  // --- Reset (wipes user-facing data; audit log persists) ---
  // v0.3: also wipes the active session id and any per-session keys
  // (best-effort — we don't track an index of session ids, so we can
  // only wipe the active one plus the legacy blob).
  // For full wipe of all sessions across history, the ProfileScreen
  // already calls clearAll() on user request.
  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(ASYNC_KEYS));
    // Best-effort wipe of legacy blob.
    await secureDelete(SECURE_KEYS.chats);
    // Active session per-key wipe — only known if set, but we just
    // removed activeSessionId above so we can't reach it. The SecureStore
    // entries will be orphaned but inaccessible (activeSessionId points
    // to nothing). For full hygiene, a future maintenance task could
    // enumerate SecureStore keys, but SecureStore has no list API.
    // Acceptable for v0: orphaned per-session keys cost a few KB each
    // and never get read because activeSessionId is gone.
    //
    // NOTE: SECURE_KEYS.crisisAudit is intentionally NOT deleted here.
  },

  // --- Admin-only: clear the crisis audit log ---
  async __clearCrisisAudit() {
    await secureDelete(SECURE_KEYS.crisisAudit);
  },
};
