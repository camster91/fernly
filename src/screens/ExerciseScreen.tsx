// Exercise — single exercise flow.
// Different exercises get different UIs. v0: box breathing is the only
// fully-built flow; others show a description + "begin" stub.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, space, type as t, radius } from '../theme';
import { getExercise } from '../data/exercises';
import type { RootStackParamList } from '../nav/RootNav';

export function ExerciseScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Exercise'>>();
  const nav = useNavigation();
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
          onPress={() => nav.goBack()}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.ctaText}>Begin</Text>
        </Pressable>
        <Text style={styles.note}>Flow builds out in build week 2.</Text>
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
  const [cycle, setCycle] = useState(0);
  const [seconds, setSeconds] = useState(PHASES[0].seconds);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s > 1) return s - 1;
        // advance phase
        setCycle((c) => (c + 1) % PHASES.length);
        return PHASES[(cycle + 1) % PHASES.length].seconds;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, cycle]);

  const current = PHASES[cycle];
  const scale =
    current.phase === 'inhale'
      ? 1 + ((PHASES[0].seconds - seconds) / PHASES[0].seconds) * 0.4
      : current.phase === 'exhale'
        ? 1.4 - ((PHASES[2].seconds - seconds) / PHASES[2].seconds) * 0.4
        : current.phase === 'hold1'
          ? 1.4
          : 1.0;

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>BODY · 4 MIN · CYCLE {cycle + 1} OF 4</Text>
      </View>

      <View style={styles.center}>
        <View style={[styles.bubble, { transform: [{ scale }] }]}>
          <Text style={styles.bubbleNumber}>{seconds}</Text>
          <Text style={styles.bubblePhase}>{current.label.toUpperCase()}</Text>
        </View>
        <Text style={styles.instructions}>Inhale · Hold · Exhale · Hold</Text>
      </View>

      <Pressable
        onPress={() => setRunning((r) => !r)}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.ctaText}>
          {running ? 'Pause' : seconds === PHASES[0].seconds ? 'Begin' : 'Resume'}
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
  ctaText: { color: colors.paper, fontWeight: '700', fontSize: 16 },
});
