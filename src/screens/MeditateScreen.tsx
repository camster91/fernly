// Meditate — guided session library
// Sections: Meditations, Sleep, SOS, Basics course. Tap a row → Player.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { colors, space, type as t } from '../theme';
import {
  CATEGORY_LABELS,
  durationLabel,
  sessions,
  type SessionCategory,
  type SessionDef,
} from '../data/sessions';
import type { RootStackParamList } from '../nav/RootNav';

const SECTION_ORDER: SessionCategory[] = ['meditate', 'sleep', 'sos', 'course'];

function sectionSessions(category: SessionCategory): SessionDef[] {
  const list = sessions.filter((s) => s.category === category);
  return category === 'course'
    ? [...list].sort((a, b) => (a.courseOrder ?? 0) - (b.courseOrder ?? 0))
    : list;
}

export function MeditateScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.h1}>Meditate</Text>
        <Text style={styles.sub}>Free guided sessions, all offline.</Text>
      </View>

      {SECTION_ORDER.map((category) => (
        <View key={category}>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            {CATEGORY_LABELS[category]}
          </Text>
          {sectionSessions(category).map((s) => {
            const mins = Math.max(1, Math.round(s.durationSec / 60));
            return (
              <Card key={s.id} style={styles.cardRow}>
                <Pressable
                  onPress={() => nav.navigate('Player', { sessionId: s.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.title}, ${mins} minutes`}
                  accessibilityHint="Opens the player"
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <Text style={cardStyles.title}>{s.title}</Text>
                  <Text style={cardStyles.sub}>{s.blurb}</Text>
                  <Text style={styles.duration}>{durationLabel(s.durationSec).toUpperCase()}</Text>
                </Pressable>
              </Card>
            );
          })}
        </View>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.s6, paddingTop: space.s7, paddingBottom: space.s5 },
  h1: { ...t.displayLg, color: colors.text, marginBottom: 6 },
  sub: { ...t.body, color: colors.textSoft },
  sectionLabel: {
    ...t.eyebrow,
    color: colors.textMuted,
    paddingHorizontal: space.s6,
    marginTop: space.s3,
    marginBottom: space.s3,
  },
  cardRow: { padding: 0 },
  row: { minHeight: 44, padding: space.s5 },
  duration: {
    fontFamily: 'Menlo',
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginTop: 8,
  },
});
