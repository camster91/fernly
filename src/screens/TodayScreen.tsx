// Today — the home/landing screen
// Greeting + streak strip + 2–3 context cards that drive engagement.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { initialMoodLabel, moodLabel } from '../components/MoodPicker';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import { localDateString } from '../util/date';
import type { UserProfile, MoodEntry } from '../types';
import type { RootStackParamList } from '../nav/RootNav';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// v0.10: separates greeting NOUN from full sentence (issue #66).
// Previously `greetingForHour` returned a complete phrase ("Good morning"),
// which the screen then used in two places — once in the eyebrow (as-is),
// once in the h1 prefixed with "Good" again — producing "Good good
// morning, name." Also, the fallback check-in prompt ("How are you waking
// up today?") was a morning phrase rendered at 9pm. The data model now
// returns the noun, an uppercase label, and a daypart-appropriate check-in
// prompt so each surface can compose the copy it actually wants.
//
// v0.10 (follow-up): the daypart function moved to
// `src/util/daypart.ts` so the unit test can import it without
// dragging the .tsx into vitest's Node loader (no JSX support
// without an esbuild config bump). TodayScreen re-exports
// `greetingForHour` for the one downstream caller that still
// uses it.
import { daypartForHour, type Daypart } from '../util/daypart';
export { daypartForHour };
export type { Daypart };

// Backwards-compatible label helper. Callers (Tests, ProfileScreen) that
// previously consumed `greetingForHour()` (a complete sentence) now get
// just the noun via this wrapper. New code should prefer `daypartForHour`.
function greetingForHour(h: number): string {
  return daypartForHour(h).noun;
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
  // v0.10 (issue #79): a focused load failure on Today is distinct
  // from a legitimate empty state. A returning user who sees "no
  // streak" because the read failed is being lied to. The screen
  // shows a small "couldn't load" chip + retry when this is set so
  // the underlying failure is visible.
  const [loadError, setLoadError] = useState<string | null>(null);

  // v0.9: re-read on every focus, not just mount. After MoodCheckIn
  // saves, returning to Today previously showed the old mood / streak
  // until app remount. useFocusEffect from react-navigation runs the
  // effect every time the screen comes into focus — the right pattern
  // for tab-bar screens that should reflect upstream changes.
  // See plans/05-full-codebase-review-2026-07-22.md P1-13.
  //
  // v0.10 (issue #79): use the result-returning safe reads so a
  // storage failure is shown to the user rather than collapsed into
  // an empty streak / no-mood-today state.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        const profileResult = await storage.getProfileSafe();
        if (cancelled) return;
        if (profileResult.kind === 'error') {
          setLoadError(profileResult.reason);
          return;
        }
        setProfile(profileResult.kind === 'ready' ? profileResult.profile : null);
        setLoadError(null);

        const moodsResult = await storage.getMoodsSafe();
        if (cancelled) return;
        if (moodsResult.kind === 'error') {
          setLoadError(moodsResult.reason);
          return;
        }
        const moods = moodsResult.kind === 'ready' ? moodsResult.moods : [];
        const today = localDateString();
        setTodayMood(moods.find((m) => m.date === today) ?? null);
        // Streak: count consecutive days from today backward. If today
        // isn't logged yet but yesterday was, count from yesterday so
        // the user sees "7-day streak" instead of "0" until they log
        // today — most habit apps treat the day as a grace period.
        const moodDates = new Set(moods.map((m) => m.date));
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayIso = localDateString(yesterday);
        // If today is missing but yesterday exists, start counting from
        // yesterday. The user-facing prompt below communicates "log today
        // to keep your N-day streak going".
        //
        // v0.9: use localDateString() to match the user's wall-clock
        // date. Streaks broken across timezone midnight boundaries
        // before this fix. See plans/05 P1-14.
        const startFromYesterday = !moodDates.has(today) && moodDates.has(yesterdayIso);
        let count = 0;
        const d = new Date();
        if (startFromYesterday) d.setDate(d.getDate() - 1);
        for (;;) {
          const iso = localDateString(d);
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
          strip.push(moodDates.has(localDateString(day)));
        }
        setWeekLog(strip);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const hour = new Date().getHours();
  const name = profile?.name || 'there';
  const firstName = name.split(' ')[0];
  // v0.10: use the new daypart helper. The eyebrow uses `label` (uppercase
  // noun), the h1 composes the natural "Good {noun}, {name}." sentence
  // without the double-prefix bug, and the prompt uses the daypart-aware
  // fallback copy. See issue #66.
  const daypart = daypartForHour(hour);
  // v0.10 (issue #80): prefer the verbatim onboarding label the user
  // tapped so Today can re-greet with the same word. Falls back to
  // the score-derived label for legacy profiles.
  const onboardingMood = initialMoodLabel(profile);

  return (
    <ScreenContainer>
      <View style={styles.greeting}>
        {/* v0.10 (issue #79): visible signal that a focused read
            failed. Without this, the user sees their normal greeting
            and a 0-day streak and assumes the app has no data. The
            chip is small and non-blocking — they can still navigate
            to Chat or Practice — but it's the difference between a
            "no data" interpretation and a "couldn't read it"
            interpretation. */}
        {loadError && (
          <View
            style={styles.loadErrorChip}
            accessible={true}
            accessibilityRole="alert"
            accessibilityLabel={`Couldn't read your data: ${loadError}. Pull down on the screen to retry, or close and reopen the app.`}
          >
            <Text style={styles.loadErrorText}>
              ⚠️ Couldn't read your data. Pull down to retry.
            </Text>
          </View>
        )}
        {/* Eyebrow: time-of-day + streak framing. New users (streak
            === 0) used to see "0-DAY STREAK" which framed them as
            failing. v0.9 shows the onboarding mood pick on first
            launch instead of an empty streak.
            See plans/05 P2-2 + P1-15. */}
        <Text style={styles.eyebrow}>
          {streak > 0
            ? `${daypart.label} · ${streak}-DAY STREAK${
                streakGrace ? ' · LOG TODAY TO KEEP IT' : ''
              }`
            : onboardingMood
              ? `${daypart.label} · STARTED ${onboardingMood.toUpperCase()}`
              : `${daypart.label}`}
        </Text>
        {/* v0.10: composed from the noun — no more "Good good morning".
            See issue #66. */}
        <Text
          style={styles.hi}
          // v0.10 (issue #82): the h1 carries header semantics so
          // VoiceOver/TalkBack rotor navigation lands on it as the
          // page title.
          accessibilityRole="header"
        >
          Good {daypart.noun}, {firstName}.
        </Text>
        {/* v0.10: prompt is daypart-aware; the prior "How are you waking
            up today?" was a morning phrase shown at 9pm. */}
        <Text style={styles.prompt}>
          {todayMood
            ? `Today's already logged as ${moodLabel(todayMood.score)} (${todayMood.score}/6). Anything else land?`
            : streakGrace
              ? `Log today to keep your ${streak}-day streak going.`
              : onboardingMood
                ? `You said you were feeling ${onboardingMood} when you signed up. How does today compare?`
                : daypart.checkInPrompt}
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
          //
          // Color-blind fix (v0.8): logged days carry a ✓ glyph in
          // addition to color. Sighted users get a redundant signal;
          // color-blind users (8% of males) get the only signal they
          // can use. Unlogged dots are outlined (border-only, no fill)
          // so the SHAPE differs too, not just the color.
          //
          // v0.9: use localDateString() instead of toISOString().slice().
          // The UTC slicing bug returned wrong-day strings for users east
          // or west of UTC, corrupting streak math and chart axes.
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
              >
                {/* ✓ glyph for done days — redundant for sighted users,
                    primary for color-blind users. Hidden from the a11y
                    tree because the parent View's accessibilityLabel
                    already conveys the state. */}
                {done && <Text style={styles.streakCheck}>✓</Text>}
              </View>
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
          {todayMood ? "Today's mood" : `${daypart.noun.charAt(0).toUpperCase() + daypart.noun.slice(1)} mood`}
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
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.paper2,
    borderWidth: 1.5,
    borderColor: colors.line,
    marginBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Done dots are filled mint + carry a ✓ glyph (added in JSX).
  // Border-only on undonedots makes the SHAPE differ too — color-blind
  // users get shape as the primary signal, color as secondary.
  streakDotDone: {
    backgroundColor: colors.mint300,
    borderColor: colors.mint300,
  },
  streakDotToday: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    boxShadow: '0 0 0 4px ' + colors.lavender100,
  },
  streakCheck: {
    color: colors.paper,
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 11,
    // Pull the glyph up 1px to visually center in the dot
    marginTop: -1,
  },
  streakLabel: { fontFamily: 'Menlo', fontSize: 9, color: colors.textMuted, letterSpacing: 0.5 },

  // v0.10 (issue #79): small inline error chip. Sits at the top of
  // the greeting block so it's the first thing the user sees when the
  // read failed. Sits inside the screen's existing padding so it
  // inherits the horizontal rhythm.
  loadErrorChip: {
    backgroundColor: colors.yellow100,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  loadErrorText: { ...t.small, color: colors.text, textAlign: 'center' },
});
