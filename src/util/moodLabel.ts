// v0.10 (issue #80): helpers for mood-score labels.
//
// MoodPicker.tsx exports the same functions for callers that
// import from the component module. The implementations live
// here so the unit test (vitest in Node, no JSX loader) can
// import them without dragging in the .tsx file.
//
// The `moodLabel` helper maps a numeric score (1-6) to a
// short adjective used in the Insights chart axis, the mood
// label below the picker, and the OnboardingScreen picker's
// numeric badge.
//
// The `initialMoodLabel` helper prefers the verbatim text the
// user tapped in onboarding (`profile.initialMoodLabel`) and
// falls back to the score-derived label for legacy profiles
// that only have the numeric score. See issue #80.
import type { MoodScore, UserProfile } from '../types';

const MOOD_LABELS: { score: MoodScore; label: string }[] = [
  { score: 1, label: 'low' },
  { score: 2, label: 'off' },
  { score: 3, label: 'okay' },
  { score: 4, label: 'good' },
  { score: 5, label: 'bright' },
  { score: 6, label: 'radiant' },
];

export function moodLabel(score: MoodScore | undefined): string {
  return MOOD_LABELS.find((m) => m.score === score)?.label ?? '—';
}

/**
 * Returns the verbatim label the user picked in onboarding, or
 * the score-derived label for legacy profiles, or null if the
 * profile has no initial mood at all.
 */
export function initialMoodLabel(
  profile: UserProfile | null | undefined,
): string | null {
  if (!profile) return null;
  if (profile.initialMoodLabel) return profile.initialMoodLabel;
  if (profile.initialMood !== undefined) return moodLabel(profile.initialMood);
  return null;
}
