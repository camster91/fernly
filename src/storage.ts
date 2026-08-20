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
  // v0.11 (issue #41): chat backend feature flag override. Set
  // '1' to force-enable the real chat backend for this device
  // (internal cohort); '0' to force-disable; unset to defer to env.
  // Plain string so we don't need JSON parsing on a single-byte
  // value — see chat-feature-flag.ts.
  chatBackendOverride: '@fernly/chat-backend-override',
  // v0.11 (issue #41): chat usage counter. JSON object with the
  // shape consumed by chat-usage.ts. Stored unencrypted (low
  // sensitivity — these are just timestamps + counts).
  chatUsage: '@fernly/chat-usage',
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

// v0.10 (issue #79): human-readable description of a storage error.
// Used by the result-returning getProfileSafe/getMoodsSafe so the
// caller can show "Couldn't read your profile: <reason>" rather than
// silently treating the error as a fresh install.
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || 'unknown error';
  if (typeof e === 'string') return e;
  return 'unknown error';
}

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

// v0.10 (issue #52): strict variant of asyncSet. Throws on failure
// so callers (e.g. setProfileStrict) can surface a real error to the
// user. The legacy asyncSet remains for best-effort callers.
async function asyncSetStrict(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
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
    // Swallow per-write errors. Chat-write paths (setChatSession,
    // appendMessageToSession) are best-effort: a failed write loses the
    // in-flight message but the next send retries. Audit-log writes
    // (appendCrisisAudit) are fire-and-forget by design.
    //
    // Callers that need to detect a failed write should use
    // secureSetStrict below. Today that's only getChats() legacy
    // migration, which must not delete the legacy blob until every
    // per-session key actually exists.
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

// v0.10 (issue #52): strict variant of writeSessionIndex. Throws on
// failure so the strict write paths can surface a real error.
async function writeSessionIndexStrict(list: string[]): Promise<void> {
  // Dedup before writing — setChatSessionStrict can be called after
  // a partial failure that left the index in an unknown state.
  const dedup = Array.from(new Set(list));
  await AsyncStorage.setItem(ASYNC_KEYS.sessionKeyIndex, JSON.stringify(dedup));
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
    // v0.10 (issue #52): strict variant. The legacy `setProfile`
    // swallowed AsyncStorage failures (best-effort) so the onboarding
    // screen couldn't tell the difference between a successful save
    // and one that silently failed. The strict variant throws so the
    // caller's try/catch can surface a real error. The legacy
    // best-effort path remains for any caller that explicitly wants
    // it (currently none — onboarding now uses setProfileStrict).
    await asyncSetStrict(ASYNC_KEYS.profile, p);
  },
  async setProfileStrict(p: UserProfile): Promise<void> {
    await asyncSetStrict(ASYNC_KEYS.profile, p);
  },

  // v0.10 (issue #79): result-returning profile read. Unlike
  // getProfile(), which collapses "no record" and "read failure" into
  // the same null return, this distinguishes them so the calling
  // screen can show a "couldn't read your data" state instead of
  // routing a returning user into onboarding or an empty Today.
  //
  // - kind: 'empty'  → no profile record exists (legitimate first run)
  // - kind: 'ready'  → profile record exists and parsed
  // - kind: 'error'  → AsyncStorage threw OR the record exists but is
  //                    not valid JSON / not a valid UserProfile shape.
  //                    The caller must NOT treat this as a first run
  //                    — that path is reserved for kind: 'empty'.
  async getProfileSafe(): Promise<
    | { kind: 'empty' }
    | { kind: 'ready'; profile: UserProfile }
    | { kind: 'error'; reason: string }
  > {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(ASYNC_KEYS.profile);
    } catch (e) {
      return { kind: 'error', reason: describeError(e) };
    }
    if (raw === null) return { kind: 'empty' };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || !('onboarded' in parsed)) {
        return { kind: 'error', reason: 'profile record is malformed' };
      }
      return { kind: 'ready', profile: parsed as UserProfile };
    } catch (e) {
      return { kind: 'error', reason: describeError(e) };
    }
  },

  // --- Moods (unencrypted AsyncStorage) ---
  async getMoods(): Promise<MoodEntry[]> {
    return (await asyncGet<MoodEntry[]>(ASYNC_KEYS.moods)) ?? [];
  },
  // v0.10 (issue #79): result-returning moods read. Same shape as
  // getProfileSafe — distinguishes "no moods yet" from "couldn't
  // read moods". Today and Insights use this so a read failure
  // doesn't show an empty chart + "no streak" message when the
  // user's data is still on disk.
  async getMoodsSafe(): Promise<
    | { kind: 'empty' }
    | { kind: 'ready'; moods: MoodEntry[] }
    | { kind: 'error'; reason: string }
  > {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(ASYNC_KEYS.moods);
    } catch (e) {
      return { kind: 'error', reason: describeError(e) };
    }
    if (raw === null) return { kind: 'empty' };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return { kind: 'error', reason: 'moods record is malformed' };
      }
      return { kind: 'ready', moods: parsed as MoodEntry[] };
    } catch (e) {
      return { kind: 'error', reason: describeError(e) };
    }
  },
  async addMood(m: MoodEntry) {
    const all = await storage.getMoods();
    const filtered = all.filter((x) => x.date !== m.date);
    await asyncSet(ASYNC_KEYS.moods, [m, ...filtered]);
  },
  // v0.10 (issue #52): strict mood add. Throws on AsyncStorage
  // failure so the MoodCheckInScreen can surface a real error
  // instead of silently failing and closing the screen.
  async addMoodStrict(m: MoodEntry): Promise<void> {
    const all = await storage.getMoods();
    const filtered = all.filter((x) => x.date !== m.date);
    await asyncSetStrict(ASYNC_KEYS.moods, [m, ...filtered]);
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
  // v0.10 (issue #52): strict variant. Throws on failure so the
  // RootNav.onDone path can verify the flag actually persisted
  // before flipping the user into the main tabs.
  async setOnboardedStrict(v: boolean): Promise<void> {
    await AsyncStorage.setItem(ASYNC_KEYS.onboarding, v ? 'true' : 'false');
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

  // --- Generic AsyncStorage string get/set (v0.11) ---
  // Exposed so chat-feature-flag.ts can persist the override
  // without depending on AsyncStorage directly. Best-effort
  // (matches the existing asyncGetString / asyncSetString policy).
  async asyncGetString(key: string): Promise<string | null> {
    return asyncGetString(key);
  },
  async asyncSetString(key: string, value: string): Promise<void> {
    await asyncSetString(key, value);
  },

  // --- Chat backend override (v0.11, issue #41) ---
  // String-keyed: '1' = force on, '0' = force off, '' / null = no
  // preference. Kept as a plain string (not JSON) because there's
  // nothing to serialize — the chat-feature-flag module owns the
  // truthy/falsey contract.
  async getChatBackendOverride(): Promise<string | null> {
    return asyncGetString(ASYNC_KEYS.chatBackendOverride);
  },
  async setChatBackendOverride(value: string): Promise<void> {
    await asyncSetString(ASYNC_KEYS.chatBackendOverride, value);
  },

  // --- Chat usage counter (v0.11, issue #41) ---
  // Backing store for the per-day / per-minute rate limiter in
  // chat-usage.ts. The shape is owned by that module — this method
  // just returns `unknown` so the parser is colocated with the
  // decision logic, not with storage.
  async getChatUsage(): Promise<unknown> {
    return asyncGet<unknown>(ASYNC_KEYS.chatUsage);
  },
  async setChatUsage(usage: unknown): Promise<void> {
    await asyncSet(ASYNC_KEYS.chatUsage, usage);
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
  async setChatSession(session: ChatSession): Promise<void> {
    const next = { ...session, version: CURRENT_CHAT_VERSION };
    await secureSet(sessionKey(session.id), next);
    await addToSessionIndex(sessionKey(session.id));
  },

  // v0.10 (issue #52): strict chat-session write. Throws on either
  // the SecureStore write or the index append. Used by chat-send
  // paths that have already restored the draft on failure; the
  // legacy swallow variant remains for callers that explicitly want
  // best-effort.
  async setChatSessionStrict(session: ChatSession): Promise<void> {
    const next = { ...session, version: CURRENT_CHAT_VERSION };
    await secureSetStrict(sessionKey(session.id), next);
    await writeSessionIndexStrict([...await readSessionIndex(), sessionKey(session.id)]);
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

  // v0.10 (issue #52): enumerate every current chat session by
  // walking the index, with a soft read for each entry. Returns the
  // parsed sessions plus the list of keys that failed to read (so
  // export and stats counters know when the result is partial).
  // This is the canonical "list all chats" path — getChats() (the
  // legacy single-blob walker) is now an internal migration helper
  // and is no longer used for export / counts.
  async getAllChatSessions(): Promise<{ sessions: ChatSession[]; unreadable: string[] }> {
    // First, ensure the legacy blob (if any) is migrated into
    // per-session keys. This is what the v0.3 → v0.10+ install path
    // hits. We don't fail the whole enumeration if migration throws;
    // we report it as a single unreadable key.
    let legacyFailed = false;
    try {
      await storage.getChats();
    } catch {
      legacyFailed = true;
    }
    const keys = await readSessionIndex();
    const sessions: ChatSession[] = [];
    const unreadable: string[] = [];
    if (legacyFailed) unreadable.push(SECURE_KEYS.chats);
    // Read each session key in parallel. A single failure does not
    // block the rest of the enumeration.
    const results = await Promise.allSettled(
      keys.map((k) => storage.getChatSessionByKey(k)),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        if (r.value) sessions.push(r.value);
        else unreadable.push(keys[i]);
      } else {
        unreadable.push(keys[i]);
      }
    }
    // Sort newest first by startedAt for predictable UI ordering.
    sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return { sessions, unreadable };
  },

  // Internal: read a session by its full SecureStore key (not its
  // session id). Used by getAllChatSessions to walk the index.
  async getChatSessionByKey(key: string): Promise<ChatSession | null> {
    const raw = await secureGet<unknown>(key);
    if (!raw) return null;
    return migrateChatSession(raw);
  },

  // Legacy list-all-chats API. v0.3: this is only useful for the
  // ProfileScreen stats counter. Walks the legacy single-blob key
  // (if present) for v0 users and counts entries.
  //
  // v0.10 (issue #52): still part of the public API for
  // backward compatibility, but ProfileScreen / SettingsScreen now
  // prefer getAllChatSessions() which walks the index rather than
  // the legacy single blob. Calling getChats() on a v0.10+ install
  // (no legacy blob) returns [] — this is correct but no longer
  // the source of truth for "how many chats does this user have".
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

  // v0.10 (issue #70): delete a single chat session by id. Used
  // by the chat history sheet to remove a single conversation
  // without affecting the rest of the user's data. Returns true
  // if the session was found and deleted, false if the id didn't
  // exist. Removes the session key from the index AND from
  // SecureStore so clearAll() can't find it later.
  async deleteChatSession(id: string): Promise<boolean> {
    // Only the key itself, not the message count, is sensitive to
    // race conditions: a concurrent append would have already
    // re-added the key to the index. We snapshot the index, remove
    // the key, and write back — if a concurrent writer races us
    // their re-add wins (the user's "delete" intent is preserved
    // for the visible session, and the next write will keep the
    // session in the index).
    const keys = await readSessionIndex();
    const target = sessionKey(id);
    if (!keys.includes(target)) {
      // The session may still exist in SecureStore (legacy
      // migration paths can write a session without indexing it
      // in old code). Try the delete anyway so a manual
      // delete-from-history still works.
      try {
        await secureDeleteStrict(target);
      } catch {
        // Nothing to do — the key genuinely doesn't exist.
      }
      return false;
    }
    const next = keys.filter((k) => k !== target);
    await writeSessionIndexStrict(next);
    try {
      await secureDeleteStrict(target);
    } catch {
      // The SecureStore delete failed; the key remains in the
      // keychain but is no longer indexed. clearAll() won't find
      // it. The session is effectively gone from the user-visible
      // history. We return true because the user-facing effect
      // (session is no longer reachable) is achieved.
    }
    // If the deleted session was the active one, clear the active
    // id so the next chat mount starts a fresh session rather
    // than pointing at a deleted one.
    const active = await storage.getActiveSessionId();
    if (active === id) {
      await storage.setActiveSessionId(null);
    }
    return true;
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
  //
  // v0.10 (issue #52): clearAll() now returns a structured result
  // listing which targeted records were verified-deleted. The
  // ProfileScreen reset flow uses this to surface partial-failure
  // states instead of silently declaring success. The legacy
  // swallow-on-error behavior is preserved for any caller that
  // doesn't care about the result (none today — ProfileScreen now
  // awaits and inspects).
  async clearAll(): Promise<ClearAllResult> {
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
    let asyncRemoved = 0;
    const asyncResults = await Promise.allSettled(
      keysToRemove.map((k) => AsyncStorage.removeItem(k)),
    );
    asyncRemoved = asyncResults.filter((r) => r.status === 'fulfilled').length;

    // 3. Wipe the legacy single-blob key if it still exists.
    let legacyDeleted = false;
    try {
      await secureDeleteStrict(SECURE_KEYS.chats);
      legacyDeleted = true;
    } catch {
      legacyDeleted = false;
    }

    // 4. Enumerate and delete every per-session SecureStore key. Use
    // allSettled so a single failure (e.g. keychain locked mid-reset)
    // doesn't block the rest. Per-key failures are returned in the
    // result so the ProfileScreen can warn the user.
    const sessionResults = await Promise.allSettled(
      sessionKeys.map((k) => SecureStore.deleteItemAsync(k, SECURE_OPTIONS)),
    );
    const sessionsDeleted = sessionResults.filter((r) => r.status === 'fulfilled').length;
    const sessionsFailed = sessionResults
      .map((r, i) => (r.status === 'rejected' ? sessionKeys[i] : null))
      .filter((k): k is string => k !== null);

    // 5. Drop the now-drained session key index. (The removeMany above
    // skipped it; clear it here.)
    let indexRemoved = true;
    try {
      await AsyncStorage.removeItem(ASYNC_KEYS.sessionKeyIndex);
    } catch {
      indexRemoved = false;
    }

    // NOTE: SECURE_KEYS.crisisAudit is intentionally NOT deleted here.

    const result: ClearAllResult = {
      asyncStorageRemoved: asyncRemoved,
      legacyDeleted,
      sessionsDeleted,
      sessionsFailed,
      indexRemoved,
      auditRetained: true,
    };

    // Notify subscribers (RootNav) that a reset happened so they can
    // re-read state. This runs even if the AsyncStorage removeMany
    // above partially failed — the partial-failure case is rare but
    // we want listeners to know we attempted a reset.
    emitReset();
    return result;
  },
};

// v0.10 (issue #52): result type for clearAll(). The ProfileScreen
// reset flow inspects this to surface partial-failure states
// (e.g. "5 of 7 sessions deleted — 2 still in your keychain, try
// again"). Each field is computed from the actual delete outcome,
// not a best-effort assumption.
export interface ClearAllResult {
  /** Number of AsyncStorage keys successfully removed. */
  asyncStorageRemoved: number;
  /** True iff the legacy single-blob chat key was deleted. */
  legacyDeleted: boolean;
  /** Number of per-session SecureStore keys successfully deleted. */
  sessionsDeleted: number;
  /** Per-session keys that failed to delete. Should be retried. */
  sessionsFailed: string[];
  /** True iff the session-key index was successfully dropped. */
  indexRemoved: boolean;
  /** True iff the crisis audit log was intentionally retained. */
  auditRetained: boolean;
}

// v0.10 (issue #52): strict variant of secureDelete. Throws on
// failure so the clearAll result can report which keys were
// successfully deleted vs which need a retry.
async function secureDeleteStrict(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
}
