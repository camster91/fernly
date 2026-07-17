// Mood picker — 6 emoji buttons in a row, scales 1–6.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';
import type { MoodScore } from '../types';

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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.s6,
    marginBottom: space.s4,
  },
  pill: {
    width: 44,
    height: 44,
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
