// v0.10 (issue #80): tests for the initialMoodLabel helper.
// The implementation lives in src/util/moodLabel.ts; this
// test file imports it directly to avoid crossing into a
// .tsx (vitest's Node loader doesn't parse JSX by default).
//
// Pre-fix: UserProfile.initialMood only stored the score
// (1-6). Multiple distinct onboarding labels mapped to the
// same score, so Today greeted the user with a different
// word than they picked (e.g. "Tired" -> score 2 -> "off").
// Post-fix: initialMoodLabel persists the verbatim text.

import { describe, expect, it } from 'vitest';
import { initialMoodLabel, moodLabel } from '../moodLabel';
import type { UserProfile } from '../../types';

function profile(overrides: Partial<UserProfile>): UserProfile {
  return {
    name: 'Test',
    mascot: 'moon',
    tone: 'soft',
    goals: [],
    onboarded: true,
    createdAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  };
}

describe('initialMoodLabel (issue #80)', () => {
  it('returns the verbatim label when initialMoodLabel is set', () => {
    expect(
      initialMoodLabel(
        profile({ initialMood: 2, initialMoodLabel: 'Tired' }),
      ),
    ).toBe('Tired');
  });

  it('returns the verbatim label even when score and label disagree', () => {
    // "Anxious", "Tired", "Overwhelmed", "Lonely" all map to
    // score 2, so a score-derived label would be wrong for any
    // of them. The verbatim label is the source of truth.
    expect(
      initialMoodLabel(
        profile({ initialMood: 2, initialMoodLabel: 'Anxious' }),
      ),
    ).toBe('Anxious');
    expect(
      initialMoodLabel(
        profile({ initialMood: 2, initialMoodLabel: 'Lonely' }),
      ),
    ).toBe('Lonely');
  });

  it('falls back to moodLabel(score) for legacy profiles with only initialMood', () => {
    // Pre-v0.10 profiles have initialMood but no initialMoodLabel.
    // The helper must still produce a sensible label so the
    // greeting doesn't break.
    expect(initialMoodLabel(profile({ initialMood: 5 }))).toBe(moodLabel(5));
    expect(initialMoodLabel(profile({ initialMood: 1 }))).toBe(moodLabel(1));
  });

  it('prefers initialMoodLabel over the score-derived fallback', () => {
    // If both are set, the label wins. This is the whole point
    // of the field — the user picked a specific word and
    // expects to see that word.
    expect(
      initialMoodLabel(
        profile({ initialMood: 5, initialMoodLabel: 'Hopeful' }),
      ),
    ).toBe('Hopeful');
  });

  it('returns null when the profile has no initial mood at all', () => {
    expect(initialMoodLabel(profile({}))).toBeNull();
  });

  it('returns null for a null/undefined profile', () => {
    expect(initialMoodLabel(null)).toBeNull();
    expect(initialMoodLabel(undefined)).toBeNull();
  });
});
