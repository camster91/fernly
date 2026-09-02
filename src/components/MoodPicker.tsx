// Mood picker — 6 emoji buttons in a row, scales 1–6.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';
import type { MoodScore, UserProfile } from '../types';
// v0.10 (issue #80): the `moodLabel` + `initialMoodLabel` helpers
// live in `src/util/moodLabel.ts` so the unit test can import
// them without crossing into a .tsx file. Re-exported here for
// callers that already import from MoodPicker.
import { moodLabel as _moodLabel, initialMoodLabel as _initialMoodLabel } from '../util/moodLabel';

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

// Re-exports for backward compatibility — callers that import
// `moodLabel` / `initialMoodLabel` from MoodPicker continue to
// work. The implementations now live in src/util/moodLabel.ts.
export const moodLabel = _moodLabel;
export const initialMoodLabel = _initialMoodLabel;
// Suppress the unused-import warning for the now-redundant
// MOODS-local `label` field. The emoji picker still consumes MOODS
// for the visible row.
void MOODS;
