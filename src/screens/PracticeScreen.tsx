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
  CBT: { bg: colors.lavender100, fg: colors.lavender700 },
  ACT: { bg: colors.mint100, fg: '#1c8e58' },
  GROUNDING: { bg: colors.yellow100, fg: '#8a6500' },
  BODY: { bg: colors.peach100, fg: colors.peach500 },
  REFLECTION: { bg: colors.rose100, fg: colors.warn },
};

export function PracticeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.h1}>Practice</Text>
        <Text style={styles.sub}>Pick what fits right now.</Text>
      </View>

      {exercises.map((ex) => {
        const tag = MODALITY_COLOR[ex.modality] ?? { bg: colors.line, fg: colors.text };
        return (
          <Card key={ex.id} onPress={() => nav.navigate('Exercise', { exerciseId: ex.id })}>
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
