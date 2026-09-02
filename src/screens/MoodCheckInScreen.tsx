// Mood Check-In — the 30-second flow from the Today card
// 4-step: pick emoji, optional word, optional note, save
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { MoodPicker, moodLabel } from '../components/MoodPicker';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
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
      // v0.10 (issue #52): use the strict variant so a write failure
      // is not silently swallowed. The legacy addMood() would catch
      // and discard AsyncStorage errors, then nav.goBack() would
      // close the screen as if the save succeeded — a silent
      // data-loss path.
      await storage.addMoodStrict(entry);
      nav.goBack();
    } catch (e) {
      // Storage layer failed (SecureStore/AsyncStorage unavailable,
      // disk full, etc.). Show the user a clear failure rather than
      // silently leaving them stuck on the screen with a disabled
      // Save button.
      Alert.alert(
        "Couldn't save your check-in",
        e instanceof Error
          ? `Reason: ${e.message}. Please try again in a moment. If this keeps happening, try restarting the app.`
          : 'Please try again in a moment. If this keeps happening, try restarting the app.',
        [{ text: 'OK' }],
      );
    }
  }

  return (
    <ScreenContainer>
      {/* v0.10 (issue #69): header row with a visible Cancel
          affordance. The user can already back out via the
          platform's modal-close gesture, but a deterministic
          visible Cancel button is required for keyboard, web,
          and users unfamiliar with platform gestures. Cancel
          never creates an entry — it's a pure nav.goBack(). */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>
            {greetingForHour(new Date().getHours()).toUpperCase()} CHECK-IN
          </Text>
          {/* v0.10 (issue #82): header semantics for screen-reader rotor. */}
          <Text style={styles.title} accessibilityRole="header">
            How are you, really?
          </Text>
          <Text style={styles.sub}>No wrong answer. No streak loss. Just noticing.</Text>
        </View>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Cancel mood check-in"
          accessibilityHint="Discards the check-in and returns to Today"
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
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
            // v0.10 (issue #75): migrated to the shared Pill
            // primitive. Small size matches the 13pt quick-word
            // text. Selected state carries the same accentSelected
            // / paper contrast pair as the OnboardingScreen
            // mood/goal pills.
            <Pill
              key={w}
              label={w}
              selected={word === w}
              onPress={() => setWord(w === word ? undefined : w)}
              size="small"
            />
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
  // v0.10 (issue #69): header row puts the eyebrow/title/sub on
  // the left and a Cancel button on the right. The Cancel button
  // is always visible so the user has a deterministic exit.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.s6,
    paddingTop: space.s7,
    paddingBottom: space.s5,
  },
  // v0.10 (issue #69): Cancel button is text-only with 44pt min
  // tap height for accessibility. Same lavender700 accent as the
  // SettingsScreen Close button so users learn the pattern.
  cancelBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  cancelBtnText: { ...t.bodyBold, color: colors.lavender700, fontSize: 14 },
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
  // v0.10 (issue #81): selected quick-word pill uses the new
  // `accentSelected` token. Same reasoning as OnboardingScreen —
  // 8.6:1 contrast + 2px border (vs 1px) gives a non-color cue.
  wordPillActive: {
    backgroundColor: colors.accentSelected,
    borderColor: colors.accentSelected,
    borderWidth: 2,
    paddingHorizontal: 13, // keep visual size constant when border doubles
  },
  wordText: { fontSize: 13, fontWeight: '600', color: colors.text },
  wordTextActive: { color: colors.accentSelectedText, fontWeight: '700' },

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
