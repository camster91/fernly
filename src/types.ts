// Domain types — what's stored, what's queried

export type Tone = 'soft' | 'direct' | 'playful';
export type Mascot = 'moon' | 'fox' | 'turtle' | 'bee';
export type Goal =
  | 'sleep'
  | 'quiet_thoughts'
  | 'less_anxious'
  | 'self_kindness'
  | 'process_feelings'
  | 'build_habit'
  | 'just_explore';

export type MoodScore = 1 | 2 | 3 | 4 | 5 | 6;

export interface UserProfile {
  name: string;
  mascot: Mascot;
  tone: Tone;
  goals: Goal[];
  onboarded: boolean;
  createdAt: string;
}

export interface MoodEntry {
  date: string; // ISO yyyy-mm-dd
  score: MoodScore;
  word?: string; // optional one-word tag
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'fernly';
  text: string;
  at: string;
}

export interface ChatSession {
  id: string;
  startedAt: string;
  // v0.2: version field for forward-compatible schema migrations.
  // Optional in the input type so old call sites don't have to update
  // — storage.addChat defaults to v1 if absent.
  version?: 1;
  messages: ChatMessage[];
}

// v0.2: separate, encrypted crisis audit entry. Stored in expo-secure-store,
// not AsyncStorage. Survives `clearAll()` so a user wiping their chat
// history can't accidentally erase the audit trail. Schema-versioned for
// forward compatibility.
export type CrisisSeverity = 'soft' | 'hard';

export interface CrisisAuditEntry {
  // schema version — bump when changing the field shape
  version: 1;
  id: string;
  at: string; // ISO timestamp
  severity: CrisisSeverity;
  // The matched regex (e.g. "kms rn") — small, never the full message.
  // The full user text is NOT stored here. The chat history in storage.ts
  // already records the user's exact text — that's available to a future
  // reviewer with the device. The audit log is for incident response.
  matchedPhrase?: string;
  // The locale the modal showed (helpline selected). Empty = default.
  locale?: string;
}

export type ExerciseModality = 'CBT' | 'ACT' | 'GROUNDING' | 'BODY' | 'REFLECTION';

export interface ExerciseDef {
  id: string;
  title: string;
  modality: ExerciseModality;
  durationMin: number;
  emoji: string;
  blurb: string;
  description: string;
}
