// Exercise — single exercise flow.
// Different exercises get different UIs. v0: box breathing is the only
// fully-built flow; others show a description + "begin" stub.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
        {/* v0.10 (issue #82): header semantics for screen-reader rotor. */}
        <Text style={styles.title} accessibilityRole="header">
          {ex.title}
        </Text>
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

// Box breathing — animated 4-4-4-4 cycle.
//
// v0.8: previously the session ran forever with a misleading
// 'BODY · 4 MIN · CYCLE N OF 4' eyebrow. The label said "4 minutes"
// but no timer counted down. v0.8 fixes this with a fixed
// `TOTAL_CYCLES` and a completion state that stops the timer.
//
// Cycle math: 4 phases × 4 seconds = 16s per cycle. 15 cycles =
// 240 seconds = exactly 4 minutes. The TodayScreen card promises
// "4 minutes. Calms your nervous system fast." — this delivers it.
//
// Phase transitions: 4s inhale → 4s hold1 → 4s exhale → 4s hold2 →
// (rolls back to inhale). The cycle counter in the eyebrow
// tracks how many complete cycles the user has done.
type Phase = 'inhale' | 'hold1' | 'exhale' | 'hold2';
const PHASES: { phase: Phase; label: string; seconds: number }[] = [
  { phase: 'inhale', label: 'Breathe in', seconds: 4 },
  { phase: 'hold1', label: 'Hold gently', seconds: 4 },
  { phase: 'exhale', label: 'Breathe out', seconds: 4 },
  { phase: 'hold2', label: 'Hold empty', seconds: 4 },
];
const SECONDS_PER_CYCLE = PHASES.reduce((s, p) => s + p.seconds, 0); // 16
const TOTAL_SECONDS = 4 * 60; // 4 minutes
const TOTAL_CYCLES = Math.floor(TOTAL_SECONDS / SECONDS_PER_CYCLE); // 15

function BoxBreathingScreen() {
  // v0.5 + v0.7: combined phase+seconds into a single state object so the
  // setInterval can use only functional updaters. Effect deps are
  // [running, completed] only — the interval stays alive for the entire
  // session, not torn down/rebuilt every 4s on phase advance.
  //
  // v0.8: also tracks `completed` cycles. When completed === TOTAL_CYCLES
  // the timer auto-stops and shows a 'Done' state. This honors the
  // "4 minutes" promise from the TodayScreen card.
  type State = { phaseIndex: number; secondsLeft: number };
  const [state, setState] = useState<State>({
    phaseIndex: 0,
    secondsLeft: PHASES[0].seconds,
  });
  const { phaseIndex, secondsLeft } = state;
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const finished = completed >= TOTAL_CYCLES;
  // v0.10 (issue #69): typed navigation so the End-session button
  // can goBack() deterministically (rather than relying on the
  // back-gesture alone, which users on web/keyboard may not
  // discover).
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (!running || finished) return;
    const id = setInterval(() => {
      setState((prev) => {
        if (prev.secondsLeft > 1) {
          return { phaseIndex: prev.phaseIndex, secondsLeft: prev.secondsLeft - 1 };
        }
        // Roll over to next phase. v0.8: fire a haptic so users with eyes
        // closed (the actual use case for a breathing exercise) get a
        // non-visual cue when the phase changes. Different intensity per
        // phase — inhale/exhale get a soft tap (light work), holds get a
        // notification (the 'boundary' moment). Web and iOS simulator are
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
        // v0.8: when we wrap back to inhale (nextIndex === 0), one cycle
        // is complete. Increment `completed`; if we've hit TOTAL_CYCLES,
        // the early-return at the top of the next tick stops the timer.
        if (nextIndex === 0) {
          setCompleted((c) => c + 1);
        }
        return { phaseIndex: nextIndex, secondsLeft: nextPhase.seconds };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, finished]);

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
    // v0.10 (issue #62): the bubble + the Begin/Pause CTA
    // + the exit button are too tall for a 568pt viewport at
    // 200% text scale. Switched to a scrolling container so
    // the CTA never clips off the bottom edge on short
    // devices. The bubble keeps its fixed visual size — the
    // scroll only matters when the surrounding chrome is too
    // tall for the viewport.
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>
          BODY · 4 MIN · CYCLE {Math.min(completed + 1, TOTAL_CYCLES)} OF {TOTAL_CYCLES}
          {finished ? ' · DONE' : ''}
        </Text>
      </View>

      <View style={styles.center}>
        <View
          style={[styles.bubble, { transform: [{ scale }] }]}
          accessibilityRole="image"
          accessibilityLabel={
            finished
              ? 'Box breathing complete'
              : `${current.label}, ${secondsLeft} seconds remaining`
          }
        >
          <Text style={styles.bubbleNumber}>{finished ? '✓' : secondsLeft}</Text>
          <Text
            style={styles.bubblePhase}
            accessibilityLiveRegion="polite"
            accessibilityElementsHidden={false}
          >
            {finished ? 'COMPLETE' : current.label.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.instructions}>Inhale · Hold · Exhale · Hold</Text>
      </View>

      <Pressable
        onPress={() => {
          if (finished) {
            // Reset for another session.
            setCompleted(0);
            setState({ phaseIndex: 0, secondsLeft: PHASES[0].seconds });
            setRunning(false);
            return;
          }
          setRunning((r) => !r);
        }}
        accessibilityRole="button"
        accessibilityState={{ busy: running }}
        accessibilityLabel={
          finished
            ? 'Restart box breathing'
            : running
              ? 'Pause box breathing'
              : secondsLeft === PHASES[0].seconds
                ? 'Begin box breathing'
                : 'Resume box breathing'
        }
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.ctaText}>
          {finished
            ? 'Restart'
            : running
              ? 'Pause'
              : secondsLeft === PHASES[0].seconds
                ? 'Begin'
                : 'Resume'}
        </Text>
      </Pressable>

      {/* v0.10 (issue #69): visible exit affordance for the
          exercise flow. The system back button still works (the
          useEffect cleans up the timer on unmount), but a
          deterministic visible button is required for keyboard,
          web, and users unfamiliar with platform gestures. Label
          changes between states so the user understands what
          ending the session does. */}
      <Pressable
        onPress={() => nav.goBack()}
        accessibilityRole="button"
        accessibilityLabel={
          finished
            ? 'Done — return to practice'
            : running
              ? 'End session and return to practice'
              : 'Exit without starting'
        }
        style={({ pressed }) => [styles.exitBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.exitBtnText}>
          {finished ? 'Done' : running ? 'End session' : 'Exit'}
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
    marginBottom: space.s4,
  },
  ctaDisabled: { backgroundColor: colors.ink4, opacity: 0.6 },
  ctaText: { color: colors.paper, fontWeight: '700', fontSize: 16 },

  // v0.10 (issue #69): exercise exit button. Text-only, sits below
  // the Begin/Pause/Resume CTA. 44pt min height for tap target
  // compliance (WCAG 2.5.5).
  exitBtn: {
    minHeight: 44,
    marginHorizontal: space.s6,
    marginBottom: space.s7,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  exitBtnText: { ...t.bodyBold, color: colors.lavender700, fontSize: 14 },
});
