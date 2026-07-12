// Storage layer — typed, namespaced, schema-versioned.
//
// v0.2 partitioning:
//   AsyncStorage (unencrypted):
//     - profile (low sensitivity)
//     - moods (date + 1-6 score; mood journal content is privacy-sensitive
//       in aggregate but a single entry without chat context is moderate)
//     - onboarding-complete flag
//     - exercise sessions
//
//   expo-secure-store (encrypted, device-unlock-gated, no iCloud backup):
//     - chats (full chat history — includes crisis-flagged user text)
//     - crisis-audit (separate, write-only log; survives clearAll)
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
import type { UserProfile, MoodEntry, ChatSession, CrisisAuditEntry } from './types';

// ---- AsyncStorage keys (unencrypted) ----
const ASYNC_KEYS = {
  profile: '@fernly/profile',
  moods: '@fernly/moods',
  sessions: '@fernly/sessions',
  onboarding: '@fernly/onboarding-complete',
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
  chats: 'fernly.chats.v1', // versioned in key name to allow rotation
  crisisAudit: 'fernly.crisis-audit.v1',
} as const;

// ---- Schema migration helpers ----
// v0 sessions didn't have a version field. Read them as v0 and treat
// as legacy. Future migrations bump CURRENT_VERSION.
const CURRENT_CHAT_VERSION = 1 as const;

function migrateChatSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ChatSession> & { id?: unknown; messages?: unknown };
  if (typeof s.id !== 'string' || !Array.isArray(s.messages)) return null;
  const messages = s.messages.filter(
    (m): m is ChatSession['messages'][number] =>
      !!m && typeof m === 'object' && 'id' in m && 'role' in m && 'text' in m && 'at' in m,
  );
  return {
    id: s.id,
    startedAt: typeof s.startedAt === 'string' ? s.startedAt : new Date().toISOString(),
    version: CURRENT_CHAT_VERSION,
    messages: messages as ChatSession['messages'],
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

  // --- Chat history (ENCRYPTED SecureStore) ---
  async getChats(): Promise<ChatSession[]> {
    const raw = await secureGet<unknown[]>(SECURE_KEYS.chats);
    if (!raw) return [];
    return raw.map(migrateChatSession).filter((s): s is ChatSession => s !== null);
  },
  async addChat(s: ChatSession) {
    const all = await storage.getChats();
    const next = { ...s, version: CURRENT_CHAT_VERSION };
    await secureSet(SECURE_KEYS.chats, [next, ...all]);
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
  // v0.2: clearAll() now distinguishes between user-wipeable keys
  // (profile, moods, onboarding, chats, sessions) and the crisis audit
  // trail, which is NOT cleared here. The audit log can only be cleared
  // by a future admin/reviewer path, not by the user.
  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(ASYNC_KEYS));
    try {
      await SecureStore.deleteItemAsync(SECURE_KEYS.chats, SECURE_OPTIONS);
    } catch {
      // swallow
    }
    // NOTE: SECURE_KEYS.crisisAudit is intentionally NOT deleted here.
  },

  // --- Admin-only: clear the crisis audit log ---
  // Currently only used by tests. v1 will gate this behind a clinician
  // auth flow, not a UI button.
  async __clearCrisisAudit() {
    try {
      await SecureStore.deleteItemAsync(SECURE_KEYS.crisisAudit, SECURE_OPTIONS);
    } catch {
      // swallow
    }
  },
};
