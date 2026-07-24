// Mood Check-In — the 30-second flow from the Today card
// 4-step: pick emoji, optional word, optional note, save
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { MoodPicker, moodLabel } from '../components/MoodPicker';
import { Card } from '../components/Card';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import { localDateString } from '../util/date';
import type { MoodScore, MoodEntry } from '../types';
import { greetingForHour } from './TodayScreen';

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
    // v0.9: store the user's local-date string, not UTC. A PST user
    // saving at 11pm local would otherwise file under tomorrow's date
    // and break streak math / chart alignment. See plans/05 P1-14.
    const entry: MoodEntry = {
      date: localDateString(),
      score,
      word,
    };
    try {
      await storage.addMood(entry);
      nav.goBack();
    } catch {
      // Storage layer failed (SecureStore/AsyncStorage unavailable,
      // disk full, etc.). Show the user a clear failure rather than
      // silently leaving them stuck on the screen with a disabled
      // Save button.
      Alert.alert(
        "Couldn't save your check-in",
        'Please try again in a moment. If this keeps happening, try restarting the app.',
        [{ text: 'OK' }],
      );
    }
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>
          {greetingForHour(new Date().getHours()).toUpperCase()} CHECK-IN
        </Text>
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
              accessibilityRole="button"
              accessibilityLabel={w}
              accessibilityState={{ selected: word === w }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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
        accessibilityRole="button"
        accessibilityLabel={score ? 'Save mood check-in' : 'Pick a mood first'}
        accessibilityState={{ disabled: !score }}
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
