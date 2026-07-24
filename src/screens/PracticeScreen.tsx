// Practice — exercise library
// Lists 8 exercises with modality tag and duration. Tap → ExerciseScreen.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { colors, space, type as t, radius } from '../theme';
import { exercises } from '../data/exercises';
import type { RootStackParamList } from '../nav/RootNav';

const MODALITY_COLOR: Record<string, { bg: string; fg: string }> = {
  // v0.7: foreground tokens unified to colors.ink for AA-body compliance.
  // Prior tokens (`#1c8e58`, `#8a6500`, `colors.peach500`, `colors.warn`)
  // were 1.99–3.45:1 against their pastel backgrounds at 10pt bold —
  // failed AA-body AND were below the AA-large 14pt-bold threshold.
  // colors.ink is 13.6:1 on every pastel here.
  CBT: { bg: colors.lavender100, fg: colors.ink },
  ACT: { bg: colors.mint100, fg: colors.ink },
  GROUNDING: { bg: colors.yellow100, fg: colors.ink },
  BODY: { bg: colors.peach100, fg: colors.ink },
  REFLECTION: { bg: colors.rose100, fg: colors.ink },
};

export function PracticeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.h1}>Practice</Text>
        <Text style={styles.sub}>Pick what fits right now.</Text>
        {/* v0.9: surface "how many of these are real" up front. Otherwise
            users assume every card is actionable — 7/8 show as
            "Coming soon" stubs on tap. Plans/05 P2-18. */}
        <View style={styles.legend}>
          <View style={styles.legendChip}>
            <Text style={styles.legendDot}>●</Text>
            <Text style={styles.legendText}>1 available now</Text>
          </View>
          <View style={styles.legendChip}>
            <Text style={[styles.legendDot, { color: colors.textMuted }]}>●</Text>
            <Text style={styles.legendText}>7 coming soon</Text>
          </View>
        </View>
      </View>

      {exercises.map((ex) => {
        const tag = MODALITY_COLOR[ex.modality] ?? { bg: colors.line, fg: colors.text };
        return (
          <Card
            key={ex.id}
            onPress={() => nav.navigate('Exercise', { exerciseId: ex.id })}
            accessibilityLabel={`${ex.title}, ${ex.modality} exercise, ${ex.durationMin} minutes`}
            accessibilityHint="Opens the exercise flow"
          >
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: tag.bg }]}>
                <Text style={styles.iconEmoji}>{ex.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cardStyles.title}>{ex.title}</Text>
                <Text style={cardStyles.sub}>{ex.blurb}</Text>
                <View style={styles.tagRow}>
                  <View style={[styles.tag, { backgroundColor: tag.bg }]}>
                    <Text style={[styles.tagText, { color: tag.fg }]}>{ex.modality}</Text>
                  </View>
                  <Text style={styles.duration}>· {ex.durationMin} MIN</Text>
                </View>
              </View>
            </View>
          </Card>
        );
      })}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.s6, paddingTop: space.s7, paddingBottom: space.s5 },
  h1: { ...t.displayLg, color: colors.text, marginBottom: 6 },
  sub: { ...t.body, color: colors.textSoft },
  legend: { flexDirection: 'row', gap: 12, marginTop: 8 },
  legendChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { fontSize: 10, color: colors.accent },
  legendText: { ...t.small, color: colors.textSoft },

  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: { fontSize: 24 },

  tagRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  tagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  duration: { fontFamily: 'Menlo', fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 },
});
