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

/**
 * v0.10: stable IDs for the onboarding mood choices (issue #80).
 * Each visible word maps to a single ID. The ID is the round-trip
 * key — display copy and the numeric score are both derivable from
 * it. Pre-v0.10 onboarding only persisted the numeric score, which
 * collapsed multiple distinct labels (Anxious / Tired / Overwhelmed /
 * Lonely all → 2) and made Today re-greet the user with a different
 * word than the one they actually picked.
 */
export type MoodId =
  | 'anxious'
  | 'numb'
  | 'tired'
  | 'hopeful'
  | 'overwhelmed'
  | 'okay'
  | 'lonely';

export interface UserProfile {
  name: string;
  mascot: Mascot;
  tone: Tone;
  goals: Goal[];
  onboarded: boolean;
  createdAt: string;
  /**
   * Optional: the mood SCORE the user picked during onboarding step 2.
   * TodayScreen uses this for a one-time greeting ("You said you were
   * feeling X when you signed up — let's see how today goes") instead
   * of asking again. Persisted so a Reset + re-onboarding starts
   * fresh. Plans/05 P1-15.
   *
   * v0.10: retained for backward compatibility. New code should prefer
   * `initialMoodLabel` (issue #80) — the score alone cannot
   * disambiguate which of multiple words the user actually selected.
   */
  initialMood?: MoodScore;
  /**
   * v0.10 (issue #80): the verbatim LABEL the user tapped in
   * onboarding step 2. The screen round-trips this through to Today
   * and Settings so the user is greeted with the word they actually
   * picked. Optional for backward compatibility with profiles
   * onboarded before this field existed; the UI falls back to
   * `initialMood` when this is missing.
   */
  initialMoodLabel?: string;
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
