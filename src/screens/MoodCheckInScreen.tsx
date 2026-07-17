// Mood Check-In — the 30-second flow from the Today card
// 4-step: pick emoji, optional word, optional note, save
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { MoodPicker, moodLabel } from '../components/MoodPicker';
import { Card } from '../components/Card';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import type { MoodScore, MoodEntry } from '../types';

const QUICK_WORDS = [
  'tired',
  'rested',
  'scattered',
  'anxious',
  'calm',
  'wired',
  'tender',
  'grateful',
];

export function MoodCheckInScreen() {
  const nav = useNavigation();
  const [score, setScore] = useState<MoodScore | undefined>();
  const [word, setWord] = useState<string | undefined>();

  async function save() {
    if (!score) return;
    const entry: MoodEntry = {
      date: new Date().toISOString().slice(0, 10),
      score,
      word,
    };
    await storage.addMood(entry);
    nav.goBack();
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MORNING CHECK-IN</Text>
        <Text style={styles.title}>How are you, really?</Text>
        <Text style={styles.sub}>No wrong answer. No streak loss. Just noticing.</Text>
      </View>

      <MoodPicker value={score} onChange={setScore} />

      {score && (
        <Text style={styles.scoreLabel}>
          {moodLabel(score).toUpperCase()} · {score}/6
        </Text>
      )}

      <Card variant="soft">
        <Text style={styles.eyebrow}>OPTIONAL</Text>
        <Text style={[t.body, { marginTop: 4, marginBottom: 12 }]}>
          Want to add one word for what's behind this?
        </Text>
        <View style={styles.words}>
          {QUICK_WORDS.map((w) => (
            <Pressable
              key={w}
              onPress={() => setWord(w === word ? undefined : w)}
              style={[styles.wordPill, word === w && styles.wordPillActive]}
            >
              <Text style={[styles.wordText, word === w && styles.wordTextActive]}>{w}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Pressable
        onPress={save}
        disabled={!score}
        style={({ pressed }) => [
          styles.cta,
          !score && styles.ctaDisabled,
          pressed && score && { opacity: 0.8 },
        ]}
      >
        <Text style={styles.ctaText}>{score ? 'Save check-in' : 'Pick a mood first'}</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.s6, paddingTop: space.s7, paddingBottom: space.s5 },
  eyebrow: { ...t.eyebrow, color: colors.lavender700, marginBottom: space.s2 },
  title: { ...t.title, color: colors.text, marginBottom: space.s2, fontSize: 28 },
  sub: { ...t.body, color: colors.textSoft },
  scoreLabel: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    letterSpacing: 1.2,
    marginBottom: space.s5,
  },

  words: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wordPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  wordPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  wordText: { fontSize: 13, fontWeight: '600', color: colors.text },
  wordTextActive: { color: colors.paper },

  cta: {
    marginHorizontal: space.s6,
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: space.s4,
  },
  ctaDisabled: { backgroundColor: colors.ink4 },
  ctaText: { color: colors.paper, fontWeight: '700', fontSize: 16 },
});
