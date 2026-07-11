// Today — the home/landing screen
// Greeting + streak strip + 2–3 context cards that drive engagement.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import type { UserProfile, MoodEntry } from '../types';
import type { RootStackParamList } from '../nav/RootNav';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function greetingForHour(h: number): string {
  if (h < 5)  return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Hey afternoon';
  if (h < 21) return 'Good evening';
  return 'Wind-down time';
}

export function TodayScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [todayMood, setTodayMood] = useState<MoodEntry | null>(null);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    (async () => {
      setProfile(await storage.getProfile());
      const today = new Date().toISOString().slice(0, 10);
      const moods = await storage.getMoods();
      setTodayMood(moods.find(m => m.date === today) ?? null);
      // Naive streak: count consecutive days from today backward
      let count = 0;
      let d = new Date();
      for (;;) {
        const iso = d.toISOString().slice(0, 10);
        if (moods.some(m => m.date === iso)) {
          count += 1;
          d.setDate(d.getDate() - 1);
        } else break;
      }
      setStreak(count);
    })();
  }, []);

  const hour = new Date().getHours();
  const name = profile?.name || 'there';
  const firstName = name.split(' ')[0];

  return (
    <ScreenContainer>
      <View style={styles.greeting}>
        <Text style={styles.eyebrow}>{greetingForHour(hour).toUpperCase()} · {streak}-DAY STREAK</Text>
        <Text style={styles.hi}>Hey {firstName} 👋</Text>
        <Text style={styles.prompt}>
          {todayMood
            ? `Today's already logged as ${todayMood.score}/6. Anything else land?`
            : 'How are you waking up today?'}
        </Text>
      </View>

      <View style={styles.streakStrip}>
        {WEEKDAYS.map((d, i) => {
          const done = i < streak % 7 || (streak >= 7 && i < 7);
          const today = i === new Date().getDay() - 1;
          return (
            <View key={i} style={styles.streakDay}>
              <View style={[
                styles.streakDot,
                done && styles.streakDotDone,
                today && styles.streakDotToday,
              ]} />
              <Text style={styles.streakLabel}>{d}</Text>
            </View>
          );
        })}
      </View>

      <Card variant="soft" onPress={() => nav.navigate('MoodCheckIn')}>
        <Text style={cardStyles.eyebrow}>CHECK-IN · 30 SEC</Text>
        <Text style={cardStyles.title}>Morning mood</Text>
        <Text style={cardStyles.sub}>Tap an emoji that fits. That's it.</Text>
      </Card>

      <Card variant="peach" onPress={() => nav.navigate('Exercise', { exerciseId: 'box-breathing' })}>
        <Text style={cardStyles.eyebrow}>TODAY'S PRACTICE</Text>
        <Text style={cardStyles.title}>Box breathing</Text>
        <Text style={cardStyles.sub}>4 minutes. Calms your nervous system fast.</Text>
      </Card>

      <Card onPress={() => nav.navigate('Tabs', { screen: 'Chat' })}>
        <Text style={cardStyles.eyebrow}>TALK IT OUT</Text>
        <Text style={cardStyles.title}>Open Fernly</Text>
        <Text style={cardStyles.sub}>A small conversation about whatever's here.</Text>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  greeting:    { paddingHorizontal: space.s6, paddingTop: space.s6, paddingBottom: space.s4 },
  eyebrow:     { ...t.eyebrow, color: colors.textMuted, marginBottom: space.s2 },
  hi:          { ...t.displayLg, color: colors.text, marginBottom: space.s2 },
  prompt:      { ...t.body, color: colors.textSoft, lineHeight: 22 },

  streakStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.paper2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.s3,
    paddingHorizontal: space.s5,
    marginHorizontal: space.s6,
    marginBottom: space.s5,
  },
  streakDay:   { alignItems: 'center' },
  streakDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.line, marginBottom: 6 },
  streakDotDone: { backgroundColor: colors.mint300 },
  streakDotToday: { backgroundColor: colors.accent, boxShadow: '0 0 0 4px ' + colors.lavender100 },
  streakLabel: { fontFamily: 'Menlo', fontSize: 9, color: colors.textMuted, letterSpacing: 0.5 },
});