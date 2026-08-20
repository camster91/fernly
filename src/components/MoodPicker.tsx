// Mood picker — 6 emoji buttons in a row, scales 1–6.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';
import type { MoodScore, UserProfile } from '../types';

const MOODS: { emoji: string; score: MoodScore; label: string }[] = [
  { emoji: '😞', score: 1, label: 'low' },
  { emoji: '😕', score: 2, label: 'off' },
  { emoji: '😐', score: 3, label: 'okay' },
  { emoji: '🙂', score: 4, label: 'good' },
  { emoji: '😊', score: 5, label: 'bright' },
  { emoji: '🥰', score: 6, label: 'radiant' },
];

interface Props {
  value?: MoodScore;
  onChange: (score: MoodScore) => void;
}

export function MoodPicker({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {MOODS.map((m) => {
        const active = value === m.score;
        return (
          <Pressable
            key={m.score}
            onPress={() => onChange(m.score)}
            accessibilityRole="button"
            accessibilityLabel={`Mood: ${m.label}, score ${m.score} of 6`}
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => [
              styles.pill,
              active && styles.active,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.emoji}>{m.emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // v0.10 (issue #62): row now wraps and gaps so 6 pills fit
  // on a 320px viewport at default text size. Previously the
  // row was a non-wrapping flex row with fixed-width 44pt
  // pills — at 200% text the row was 264pt wide (no problem
  // there) but the labels around it overflowed on smaller
  // devices. The gap + flexWrap keeps the row clean and
  // predictable across the device matrix.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: space.s6,
    marginBottom: space.s4,
    gap: 8,
  },
  pill: {
    // v0.10 (issue #62): 44pt minimum tap target per WCAG 2.5.5.
    // Previously a hardcoded 44×44, which is fine on its own
    // but the absence of flexBasis made the wrap layout
    // uneven. flexBasis '15%' on a 6-item row gives a roughly
    // even split with a little margin for the gap.
    flexBasis: '15%',
    flexGrow: 1,
    minHeight: 44,
    aspectRatio: 1,
    maxWidth: 60,
    borderRadius: radius.full,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    backgroundColor: colors.lavender100,
    borderColor: colors.accent,
    borderWidth: 2,
    transform: [{ scale: 1.15 }],
  },
  emoji: { fontSize: 22 },
});

export function moodLabel(score: MoodScore | undefined): string {
  return MOODS.find((m) => m.score === score)?.label ?? '—';
}

/**
 * v0.10 (issue #80): the user-facing label for the mood the user
 * picked during onboarding. Prefers `initialMoodLabel` (the verbatim
 * word the user tapped) and falls back to the derived
 * `moodLabel(initialMood)` for profiles onboarded before the new
 * field shipped. Returns null if the profile never picked a mood.
 *
 * Why this matters: the score-based fallback collapses multiple
 * distinct onboarding labels (Anxious, Tired, Overwhelmed, Lonely
 * all → 2) into the same display word. Today and Settings screens
 * use this helper so the user sees the same word they originally
 * selected.
 */
export function initialMoodLabel(profile: UserProfile | null | undefined): string | null {
  if (!profile) return null;
  if (profile.initialMoodLabel) return profile.initialMoodLabel;
  if (profile.initialMood !== undefined) return moodLabel(profile.initialMood);
  return null;
}
