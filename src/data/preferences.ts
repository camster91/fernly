// v0.10 (issue #76): canonical preference metadata.
//
// The Mascot, Tone, Goal, and MoodId types live in src/types.ts
// (the domain enums). The data below is the SINGLE source of
// truth for the available options and the IDs each one uses.
//
// Pre-fix: the same arrays were duplicated between
// OnboardingScreen and SettingsScreen with the labels
// drifting over time — OnboardingScreen had emoji prefixes
// ("🕊 Soft"), SettingsScreen didn't ("Soft"); Onboarding
// had a `bg` field for the pastel card, Settings didn't; the
// GOALS list diverged in both label text and emoji
// decoration. A future change to the goal list (e.g. adding
// "Build confidence") would need to be made in two places
// and could be silently inconsistent.
//
// Post-fix: this file owns the canonical ID lists, emoji
// mappings, mood scores, and onboarding label variants. The
// screens that render these import the data and add their own
// presentation logic (e.g. SettingsScreen strips the emoji
// prefix for its compact row layout). Adding a new goal is
// a one-line change in this file.
import { colors } from '../theme';
import type { Goal, Mascot, MoodId, MoodScore, Tone } from '../types';

// Mascots — the user's "friend" that anchors the chat
// personality. Same emoji across all surfaces.
export const MASCOTS: { id: Mascot; emoji: string }[] = [
  { id: 'moon', emoji: '🌙' },
  { id: 'fox', emoji: '🦊' },
  { id: 'turtle', emoji: '🐢' },
  { id: 'bee', emoji: '🐝' },
];

// Tones — the chat-voice style. Two label variants: the
// emoji-prefixed onboarding label (used in the first-touch
// picker where the emoji adds personality) and the plain
// settings label (used in the compact row layout where the
// emoji would be visual noise). Two sample variants: the
// onboarding sample is the literal phrase the user would
// read; the settings sample is the in-product "this is how
// Fernly talks" preview.
export interface ToneOption {
  id: Tone;
  /** OnboardingScreen label — emoji prefix. */
  onboardingLabel: string;
  /** SettingsScreen label — plain. */
  label: string;
  /** Onboarding sample — quote-style "what Fernly says". */
  onboardingSample: string;
  /** Settings sample — instructional "how Fernly talks". */
  sample: string;
  /** Pastel background tint for the onboarding card. */
  bg: string;
}
export const TONES: ToneOption[] = [
  {
    id: 'soft',
    onboardingLabel: '🕊 Soft',
    label: 'Soft',
    onboardingSample: '"That sounds heavy. Want to sit with it?"',
    sample: 'Want to sit with it together?',
    bg: colors.lavender50,
  },
  {
    id: 'direct',
    onboardingLabel: '⚡ Direct',
    label: 'Direct',
    onboardingSample: "Let's do the thought record. 3 minutes.",
    sample: "Let's do the thought record.",
    bg: colors.peach50,
  },
  {
    id: 'playful',
    onboardingLabel: '✨ Playful',
    label: 'Playful',
    onboardingSample: 'your brain is doing the thing again lol',
    sample: 'your brain is doing the thing again lol',
    bg: colors.yellow50,
  },
];

// Goals — what the user is hoping for. Two label variants
// for the same reason as TONES: emoji-decorated onboarding
// label, plain settings label.
export interface GoalOption {
  id: Goal;
  onboardingLabel: string;
  label: string;
}
export const GOALS: GoalOption[] = [
  { id: 'sleep', onboardingLabel: '💤 Sleep better', label: 'Sleep better' },
  { id: 'quiet_thoughts', onboardingLabel: '🧠 Quiet my thoughts', label: 'Quiet my thoughts' },
  { id: 'less_anxious', onboardingLabel: '💪 Feel less anxious', label: 'Feel less anxious' },
  { id: 'self_kindness', onboardingLabel: '❤️ Be kinder to me', label: 'Be kinder to me' },
  { id: 'process_feelings', onboardingLabel: '📓 Process feelings', label: 'Process feelings' },
  { id: 'build_habit', onboardingLabel: '✨ Build a habit', label: 'Build a habit' },
  { id: 'just_explore', onboardingLabel: '🎯 Just see', label: 'Just see' },
];

// Mood choices — the onboarding step-2 "what's closest right
// now" picker. Each entry has a stable id, the visible text
// the user taps, and the numeric score that the rest of the
// app consumes (mood chart, Insights, Today greeting, etc.).
//
// The score column is the source of truth for the rest of
// the app. The verbatim text is what gets persisted as
// `initialMoodLabel` so the round-trip is exact (#80).
export interface MoodChoice {
  id: MoodId;
  text: string;
  score: MoodScore;
}
export const MOOD_CHOICES: MoodChoice[] = [
  { id: 'anxious', text: 'Anxious', score: 2 },
  { id: 'numb', text: 'Numb', score: 1 },
  { id: 'tired', text: 'Tired', score: 2 },
  { id: 'hopeful', text: 'Hopeful', score: 5 },
  { id: 'overwhelmed', text: 'Overwhelmed', score: 2 },
  { id: 'okay', text: 'Okay', score: 4 },
  { id: 'lonely', text: 'Lonely', score: 2 },
];

// Lookups for tests + the screens that need them.
export function moodById(id: MoodId): MoodChoice | null {
  return MOOD_CHOICES.find((m) => m.id === id) ?? null;
}
export function goalById(id: Goal): GoalOption | null {
  return GOALS.find((g) => g.id === id) ?? null;
}
export function toneById(id: Tone): ToneOption | null {
  return TONES.find((t) => t.id === id) ?? null;
}
