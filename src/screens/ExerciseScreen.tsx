// Exercise — single exercise flow.
// Different exercises get different UIs. v0: box breathing is the only
// fully-built flow; others show a description + "begin" stub.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, space, type as t, radius } from '../theme';
import { getExercise } from '../data/exercises';
import type { RootStackParamList } from '../nav/RootNav';

export function ExerciseScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Exercise'>>();
  const ex = getExercise(route.params.exerciseId);

  if (!ex)
    return (
      <ScreenContainer>
        <Text>Exercise not found.</Text>
      </ScreenContainer>
    );

  if (ex.id === 'box-breathing') return <BoxBreathingScreen />;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>
          {ex.modality} · {ex.durationMin} MIN
        </Text>
        <Text style={styles.title}>{ex.title}</Text>
        <Text style={styles.sub}>{ex.description}</Text>
      </View>

      <View style={styles.starter}>
        <Text style={styles.bigEmoji}>{ex.emoji}</Text>
        <Pressable
          // v0.6: stub exercises are no longer "Begin" buttons that
          // silently bounce back. Disabled with explicit "Coming soon"
          // copy so the user understands what's happening. The full
          // flows for thought-record, defusion, values-sort, etc. ship
          // in a future release.
          disabled
          accessibilityRole="button"
          accessibilityLabel="Begin this exercise"
          accessibilityState={{ disabled: true }}
          accessibilityHint="Coming soon — this exercise is not yet available"
          style={({ pressed }) => [styles.cta, styles.ctaDisabled, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.ctaText}>Coming soon</Text>
        </Pressable>
        <Text style={styles.note}>Flow builds out in a future update.</Text>
      </View>
    </ScreenContainer>
  );
}

// Box breathing — animated 4-4-4-4 cycle. Real implementation, ships tonight.
type Phase = 'inhale' | 'hold1' | 'exhale' | 'hold2';
const PHASES: { phase: Phase; label: string; seconds: number }[] = [
  { phase: 'inhale', label: 'Breathe in', seconds: 4 },
  { phase: 'hold1', label: 'Hold gently', seconds: 4 },
  { phase: 'exhale', label: 'Breathe out', seconds: 4 },
  { phase: 'hold2', label: 'Hold empty', seconds: 4 },
];

function BoxBreathingScreen() {
  // v0.5 + v0.7: combined phase+seconds into a single state object so the
  // setInterval can use only functional updaters. Effect deps are
  // [running] only — the interval stays alive for the entire session,
  // not torn down/rebuilt every 4s on phase advance.
  //
  // Phase transitions: 4s inhale → 4s hold1 → 4s exhale → 4s hold2 →
  // (rolls back to inhale). One full cycle = 16s. The phase cycle
  // counter in the eyebrow displays 1-4.
  type State = { phaseIndex: number; secondsLeft: number };
  const [{ phaseIndex, secondsLeft }, setState] = useState<State>({
    phaseIndex: 0,
    secondsLeft: PHASES[0].seconds,
  });
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setState((prev) => {
        if (prev.secondsLeft > 1) {
          return { phaseIndex: prev.phaseIndex, secondsLeft: prev.secondsLeft - 1 };
        }
        // Roll over to next phase. v0.8: fire a haptic so users with eyes
        // closed (the actual use case for a breathing exercise) get a
        // non-visual cue when the phase changes. Different intensity per
        // phase — inhale/exhale get a soft tap (light work), holds get a
        // notification (the "boundary" moment). Web and iOS simulator are
        // no-ops; physical iOS/Android devices get the real feedback.
        const nextIndex = (prev.phaseIndex + 1) % PHASES.length;
        const nextPhase = PHASES[nextIndex];
        try {
          if (Platform.OS !== 'web') {
            const isHold = nextPhase.phase === 'hold1' || nextPhase.phase === 'hold2';
            Haptics.notificationAsync(
              isHold
                ? Haptics.NotificationFeedbackType.Success
                : Haptics.NotificationFeedbackType.Warning,
            ).catch(() => undefined);
          }
        } catch {
          // expo-haptics not available (e.g. web bundling); silently no-op.
        }
        return { phaseIndex: nextIndex, secondsLeft: nextPhase.seconds };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const current = PHASES[phaseIndex];
  const scale =
    current.phase === 'inhale'
      ? 1 + ((PHASES[0].seconds - secondsLeft) / PHASES[0].seconds) * 0.4
      : current.phase === 'exhale'
        ? 1.4 - ((PHASES[2].seconds - secondsLeft) / PHASES[2].seconds) * 0.4
        : current.phase === 'hold1'
          ? 1.4
          : 1.0;

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>BODY · 4 MIN · CYCLE {phaseIndex + 1} OF 4</Text>
      </View>

      <View style={styles.center}>
        <View
          style={[styles.bubble, { transform: [{ scale }] }]}
          accessibilityRole="image"
          accessibilityLabel={`${current.label}, ${secondsLeft} seconds remaining`}
        >
          <Text style={styles.bubbleNumber}>{secondsLeft}</Text>
          <Text
            style={styles.bubblePhase}
            accessibilityLiveRegion="polite"
            accessibilityElementsHidden={false}
          >
            {current.label.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.instructions}>Inhale · Hold · Exhale · Hold</Text>
      </View>

      <Pressable
        onPress={() => setRunning((r) => !r)}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.ctaText}>
          {running ? 'Pause' : secondsLeft === PHASES[0].seconds ? 'Begin' : 'Resume'}
        </Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.s6, paddingTop: space.s7, paddingBottom: space.s5 },
  eyebrow: { ...t.eyebrow, color: colors.lavender700 },
  title: {
    ...t.title,
    fontSize: 28,
    color: colors.text,
    marginTop: 4,
    marginBottom: 8,
    lineHeight: 32,
  },
  sub: { ...t.body, color: colors.textSoft, lineHeight: 22 },

  starter: { alignItems: 'center', paddingTop: space.s8 },
  bigEmoji: { fontSize: 80, marginBottom: space.s6 },
  note: { ...t.small, color: colors.textMuted, marginTop: space.s4, textAlign: 'center' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.s9 },
  bubble: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.lavender100,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.lavender300,
  },
  bubbleNumber: { fontSize: 56, fontWeight: '800', color: colors.lavender700, letterSpacing: -1 },
  bubblePhase: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1.4,
    marginTop: 4,
  },
  instructions: { ...t.body, color: colors.textSoft, marginTop: space.s6 },

  cta: {
    marginHorizontal: space.s6,
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: space.s7,
  },
  ctaDisabled: { backgroundColor: colors.ink4, opacity: 0.6 },
  ctaText: { color: colors.paper, fontWeight: '700', fontSize: 16 },
});
