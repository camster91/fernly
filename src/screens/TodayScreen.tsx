// Today — the home/landing screen
// Greeting + streak strip + 2–3 context cards that drive engagement.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { moodLabel } from '../components/MoodPicker';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import type { UserProfile, MoodEntry } from '../types';
import type { RootStackParamList } from '../nav/RootNav';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function greetingForHour(h: number): string {
  if (h < 5) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Hey afternoon';
  if (h < 21) return 'Good evening';
  return 'Wind-down time';
}
export { greetingForHour };

export function TodayScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [todayMood, setTodayMood] = useState<MoodEntry | null>(null);
  const [streak, setStreak] = useState(0);
  // True when today is missing but yesterday was logged — UI shows the
  // grace-period prompt to nudge the user to log today.
  const [streakGrace, setStreakGrace] = useState(false);
  const [weekLog, setWeekLog] = useState<boolean[]>([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);

  useEffect(() => {
    (async () => {
      try {
        const p = await storage.getProfile();
        setProfile(p);
        const moods = await storage.getMoods();
        const today = new Date().toISOString().slice(0, 10);
        setTodayMood(moods.find((m) => m.date === today) ?? null);
        // Streak: count consecutive days from today backward. If today
        // isn't logged yet but yesterday was, count from yesterday so
        // the user sees "7-day streak" instead of "0" until they log
        // today — most habit apps treat the day as a grace period.
        const moodDates = new Set(moods.map((m) => m.date));
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayIso = yesterday.toISOString().slice(0, 10);
        // If today is missing but yesterday exists, start counting from
        // yesterday. The user-facing prompt below communicates "log today
        // to keep your N-day streak going".
        const startFromYesterday = !moodDates.has(today) && moodDates.has(yesterdayIso);
        let count = 0;
        const d = new Date();
        if (startFromYesterday) d.setDate(d.getDate() - 1);
        for (;;) {
          const iso = d.toISOString().slice(0, 10);
          if (moodDates.has(iso)) {
            count += 1;
            d.setDate(d.getDate() - 1);
          } else break;
        }
        setStreak(count);
        setStreakGrace(startFromYesterday && count > 0);
        // Week strip: 7 booleans, oldest left, today right. Index 0 is
        // 6 days ago, index 6 is today. JS getDay(): 0=Sun..6=Sat.
        // The WEEKDAYS label array is [M,T,W,T,F,S,S]; mapping index 0
        // of the strip to label "M" requires that "today" sit at index 6
        // and labels run M..S. We compute it by walking back from today.
        const strip: boolean[] = [];
        for (let i = 6; i >= 0; i--) {
          const day = new Date();
          day.setDate(day.getDate() - i);
          strip.push(moodDates.has(day.toISOString().slice(0, 10)));
        }
        setWeekLog(strip);
      } catch {
        // Storage layer failed (native module not linked, etc.).
        // Render the screen with empty state rather than crashing.
      }
    })();
  }, []);

  const hour = new Date().getHours();
  const name = profile?.name || 'there';
  const firstName = name.split(' ')[0];

  return (
    <ScreenContainer>
      <View style={styles.greeting}>
        <Text style={styles.eyebrow}>
          {greetingForHour(hour).toUpperCase()} · {streak}-DAY STREAK
          {streakGrace ? ' · LOG TODAY TO KEEP IT' : ''}
        </Text>
        <Text style={styles.hi}>Hey {firstName} 👋</Text>
        <Text style={styles.prompt}>
          {todayMood
            ? `Today's already logged as ${moodLabel(todayMood.score)} (${todayMood.score}/6). Anything else land?`
            : streakGrace
              ? `Log today to keep your ${streak}-day streak going.`
              : 'How are you waking up today?'}
        </Text>
      </View>

      <View style={styles.streakStrip}>
        {WEEKDAYS.map((d, i) => {
          // Today sits at strip index 6 (rightmost). Each dot represents
          // a specific calendar day (6 days ago through today), and we
          // render the absolute MM/DD date below it rather than a weekday
          // letter — same approach as InsightsScreen. v0.7 fix: weekday
          // letters (T F S S M T W) desync from the actual data across
          // week boundaries because the labels are computed independently
          // of which dates they represent.
          const date = new Date();
          date.setDate(date.getDate() - (6 - i));
          const dow = date.getDay(); // 0=Sun..6=Sat
          const weekdayLabel = WEEKDAYS[(dow + 6) % 7];
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          const dayLabel = `${mm}/${dd}`;
          const done = weekLog[i];
          const today = i === 6;
          // Compose a screen-reader label: weekday + date + state. VoiceOver
          // gets the same context sighted users get from the layout
          // (dot color + position) without the desync.
          const a11yLabel = `${today ? 'Today, ' : ''}${weekdayLabel} ${dayLabel}${
            done ? ', mood logged' : ', not logged'
          }`;
          return (
            <View
              key={i}
              style={styles.streakDay}
              accessible={true}
              accessibilityRole="text"
              accessibilityLabel={a11yLabel}
            >
              <View
                style={[
                  styles.streakDot,
                  done && styles.streakDotDone,
                  today && styles.streakDotToday,
                ]}
              />
              <Text style={styles.streakLabel}>{dayLabel}</Text>
            </View>
          );
        })}
      </View>

      <Card
        variant="soft"
        onPress={() => nav.navigate('MoodCheckIn')}
        accessibilityLabel={todayMood ? "Update today's mood check-in" : 'Start a mood check-in'}
        accessibilityHint="Opens the mood picker — 30 seconds"
      >
        <Text style={cardStyles.eyebrow}>CHECK-IN · 30 SEC</Text>
        <Text style={cardStyles.title}>
          {todayMood ? "Today's mood" : greetingForHour(hour) + ' mood'}
        </Text>
        <Text style={cardStyles.sub}>
          {todayMood
            ? 'Tap to update — your latest entry wins for today.'
            : "Tap an emoji that fits. That's it."}
        </Text>
      </Card>

      <Card
        variant="peach"
        onPress={() => nav.navigate('Exercise', { exerciseId: 'box-breathing' })}
        accessibilityLabel="Today's practice: Box breathing, 4 minutes"
        accessibilityHint="Opens the box breathing exercise"
      >
        <Text style={cardStyles.eyebrow}>TODAY'S PRACTICE</Text>
        <Text style={cardStyles.title}>Box breathing</Text>
        <Text style={cardStyles.sub}>4 minutes. Calms your nervous system fast.</Text>
      </Card>

      <Card
        onPress={() => nav.navigate('Tabs', { screen: 'Chat' })}
        accessibilityLabel="Open Fernly chat"
        accessibilityHint="Opens a conversation with your mascot"
      >
        <Text style={cardStyles.eyebrow}>TALK IT OUT</Text>
        <Text style={cardStyles.title}>Open Fernly</Text>
        <Text style={cardStyles.sub}>A small conversation about whatever's here.</Text>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  greeting: { paddingHorizontal: space.s6, paddingTop: space.s6, paddingBottom: space.s4 },
  eyebrow: { ...t.eyebrow, color: colors.textMuted, marginBottom: space.s2 },
  hi: { ...t.displayLg, color: colors.text, marginBottom: space.s2 },
  prompt: { ...t.body, color: colors.textSoft, lineHeight: 22 },

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
  streakDay: { alignItems: 'center' },
  streakDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.line,
    marginBottom: 6,
  },
  streakDotDone: { backgroundColor: colors.mint300 },
  streakDotToday: { backgroundColor: colors.accent, boxShadow: '0 0 0 4px ' + colors.lavender100 },
  streakLabel: { fontFamily: 'Menlo', fontSize: 9, color: colors.textMuted, letterSpacing: 0.5 },
});
