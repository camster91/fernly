// Insights — mood graph + auto-detected patterns
// v0: reads from AsyncStorage, draws a real SVG line chart of last 7 days.
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { colors, radius, space, type as t } from '../theme';
import { storage } from '../storage';
import { localDateString } from '../util/date';
import { currentStreak, sessionsCompleted, totalMinutes } from '../util/progress';
import type { MoodEntry } from '../types';

export function InsightsScreen() {
  const nav = useNavigation<any>();
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [stats, setStats] = useState({ minutes: 0, sessions: 0, streak: 0 });

  // v0.9: re-read on every focus so the chart reflects MoodCheckIn
  // saves done in another tab without an app remount. See plans/05 P1-13.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          setMoods(await storage.getMoods());
        } catch {
          setMoods([]);
        }
        try {
          const c = await storage.getCompletions();
          setStats({
            minutes: totalMinutes(c),
            sessions: sessionsCompleted(c),
            streak: currentStreak(c, new Date()),
          });
        } catch {
          setStats({ minutes: 0, sessions: 0, streak: 0 });
        }
      })();
    }, []),
  );

  // Build last 7 days (oldest left, today right). The 7-day window
  // crosses month boundaries naturally — last7[0] might be '2026-06-28'
  // while last7[6] is '2026-07-04'. Day labels use absolute MM/DD
  // (see JSX below) so they don't desync from data points when the
  // window spans two months.
  //
  // v0.9: use localDateString() to key the chart on the user's
  // wall-clock date, not UTC. Otherwise PST users see tomorrow's
  // mood on today's axis. See plans/05 P1-14.
  const last7: { score: number | null; iso: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = localDateString(d);
    const found = moods.find((m) => m.date === iso);
    last7.push({ score: found?.score ?? null, iso });
  }

  const filled = last7.filter((d) => d.score !== null) as {
    score: number;
    iso: string;
  }[];
  const avg = filled.length ? filled.reduce((s, m) => s + m.score, 0) / filled.length : null;

  // Render SVG line chart. The x-axis is calibrated to ALL 7 days
  // (oldest left, today right) regardless of how many days have data.
  // Days without data are rendered as gaps in the polyline so the
  // chart line connects only consecutive filled days — v0.7 fix for
  // the "line spans full width but data only fills 3 of 7" bug.
  // (Previously the line was scaled to filled.length-1 which stretched
  // the line across the full chart width even when the data only
  // covered days 4-6 of the 7-day window.)
  const W = 320,
    H = 100,
    PAD = 12;
  const CHART_W = W - 2 * PAD;

  // Build (x, y) points for every filled day, using its position in
  // the last7 array (0..6) so the x-axis aligns with the day labels.
  const pointsByIndex = filled.map((m) => {
    const idx = last7.findIndex((d) => d.iso === m.iso);
    const x = PAD + (idx / 6) * CHART_W;
    const y = H - PAD - ((m.score - 1) / 5) * (H - 2 * PAD);
    return { x, y, iso: m.iso };
  });

  // Group consecutive filled days into polyline segments so a missing
  // day in the middle of the week shows as a real gap rather than a
  // line connecting across the void.
  const segments: string[] = [];
  let current: string[] = [];
  let lastIdx = -2;
  for (const p of pointsByIndex) {
    const idx = last7.findIndex((d) => d.iso === p.iso);
    if (idx === lastIdx + 1) {
      current.push(`${p.x},${p.y}`);
    } else {
      if (current.length > 0) segments.push(current.join(' '));
      current = [`${p.x},${p.y}`];
    }
    lastIdx = idx;
  }
  if (current.length > 0) segments.push(current.join(' '));

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>THIS WEEK</Text>
        <Text style={styles.h1}>Your week</Text>
      </View>

      <View style={styles.tiles}>
        <StatTile
          value={stats.minutes}
          label="Minutes"
          a11y={`${stats.minutes} minutes meditated`}
        />
        <StatTile
          value={stats.sessions}
          label="Sessions"
          a11y={`${stats.sessions} sessions completed`}
        />
        <StatTile value={stats.streak} label="Day streak" a11y={`${stats.streak} day streak`} />
      </View>

      <Card>
        <View style={styles.statRow}>
          <View>
            <Text style={styles.bigStat}>{avg ? avg.toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>AVG MOOD</Text>
          </View>
          <Text style={styles.statSub}>{filled.length} of 7 days logged</Text>
        </View>

        <View style={styles.graph}>
          {filled.length >= 1 ? (
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
              {/* Y-axis tick labels (1 = low, 6 = high). Rendered in
                  emoji-text inside Svg because react-native-svg doesn't
                  accept <Text> children reliably across exporters.
                  Plans/05 P2-19. */}
              {[1, 2, 3, 4, 5, 6].map((tick) => (
                <React.Fragment key={`y-${tick}`}>
                  <Line
                    x1={PAD - 2}
                    x2={W - PAD}
                    y1={H - PAD - ((tick - 1) / 5) * (H - 2 * PAD)}
                    y2={H - PAD - ((tick - 1) / 5) * (H - 2 * PAD)}
                    stroke={colors.line}
                    strokeWidth={tick === 1 || tick === 6 ? 0.6 : 0.3}
                    strokeDasharray={tick === 1 || tick === 6 ? undefined : '2 2'}
                  />
                </React.Fragment>
              ))}
              {/* X-axis baseline */}
              <Line
                x1={PAD}
                y1={H - PAD}
                x2={W - PAD}
                y2={H - PAD}
                stroke={colors.line}
                strokeWidth={1}
              />
              {/* v0.6: with only 1 point, render the dot + axis label
                  instead of a degenerate polyline. Polyline needs ≥2
                  points to be meaningful; previously the chart hid
                  itself entirely on the first mood entry. */}
              {filled.length === 1 ? (
                (() => {
                  const m = filled[0];
                  // Center the single dot on its actual day position so
                  // the day label below the dot still aligns. v0.7 fix.
                  const idx = last7.findIndex((d) => d.iso === m.iso);
                  const cx = PAD + (idx / 6) * CHART_W;
                  const cy = H - PAD - ((m.score - 1) / 5) * (H - 2 * PAD);
                  return <Circle key={m.iso} cx={cx} cy={cy} r={6} fill={colors.accent} />;
                })()
              ) : (
                <>
                  {segments.map((seg, i) => (
                    <Polyline
                      key={`seg-${i}`}
                      points={seg}
                      fill="none"
                      stroke={colors.accent}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {pointsByIndex.map((p) => (
                    <Circle key={p.iso} cx={p.x} cy={p.y} r={5} fill={colors.accent} />
                  ))}
                </>
              )}
            </Svg>
          ) : (
            <View style={styles.emptyGraph}>
              <Text style={styles.emptyEmoji}>📈</Text>
              <Text style={styles.emptyText}>
                Log a few moods and your week starts to take shape here.
              </Text>
              {/* v0.9: empty-state CTA. Without this the empty Insights
                  state is a dead-end; user has to navigate to Today
                  manually to find the Check-in card. Plans/05 P2-20. */}
              <Pressable
                onPress={() => nav.navigate('MoodCheckIn')}
                accessibilityRole="button"
                accessibilityLabel="Log today's mood"
                accessibilityHint="Opens the mood check-in flow"
                style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.emptyCtaText}>Log today's mood</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.dayLabels}>
          {last7.map((d) => {
            // Render absolute date (e.g. "Jul 11") instead of weekday
            // letter so labels don't desync from data points across month
            // boundaries. Use the iso "MM-DD" slice for compactness.
            const [, mm, dd] = d.iso.split('-');
            return (
              <Text
                key={d.iso}
                style={[
                  styles.dayLabel,
                  d.score !== null && { color: colors.text, fontWeight: '700' },
                ]}
              >
                {`${mm}/${dd}`}
              </Text>
            );
          })}
          {/* v0.9: y-axis legend. The dashed gridlines above show
              tier positions; this legend tells the user what "1" and
              "6" mean. Plans/05 P2-19. The chart axis is mapped from
              score-1 (low) at the bottom to score-6 (high) at the
              top — same convention as the MoodPicker emoji buttons. */}
          <View style={styles.yLegend}>
            <Text style={styles.yLegendText}>1 = low</Text>
            <Text style={styles.yLegendText}>6 = high</Text>
          </View>
        </View>
      </Card>

      <Card variant="peach">
        <Text style={cardStyles.eyebrow}>PATTERN</Text>
        <Text style={cardStyles.title}>Patterns build after ~2 weeks of check-ins.</Text>
        <Text style={cardStyles.sub}>
          Fernly watches for recurring themes — work stress, sleep, weekends — and surfaces them
          gently here.
        </Text>
      </Card>
    </ScreenContainer>
  );
}

function StatTile({ value, label, a11y }: { value: number; label: string; a11y: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={a11y}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s3,
    paddingHorizontal: space.s6,
    marginBottom: space.s4,
  },
  tile: {
    flexGrow: 1,
    flexBasis: 90,
    backgroundColor: colors.paper2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.s4,
    paddingHorizontal: space.s3,
    alignItems: 'center',
  },
  tileValue: { fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  tileLabel: { ...t.eyebrow, color: colors.textMuted, marginTop: 4, fontSize: 10 },

  header: { paddingHorizontal: space.s6, paddingTop: space.s7, paddingBottom: space.s5 },
  eyebrow: { ...t.eyebrow, color: colors.textMuted, marginBottom: 6 },
  h1: { ...t.displayLg, color: colors.text },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: space.s4,
  },
  bigStat: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1.5,
    lineHeight: 48,
  },
  statLabel: { ...t.eyebrow, color: colors.textMuted, marginTop: 4 },
  statSub: { ...t.small, color: colors.textMuted },
  yLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  yLegendText: { ...t.small, color: colors.textMuted, fontSize: 10 },
  emptyCta: {
    marginTop: space.s3,
    backgroundColor: colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.full,
  },
  emptyCtaText: { ...t.bodyBold, color: colors.paper, fontSize: 14 },

  graph: { height: 100, marginVertical: space.s3 },
  emptyGraph: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 36, marginBottom: 6 },
  emptyText: { ...t.small, color: colors.textMuted, textAlign: 'center', maxWidth: 220 },

  dayLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.s3 },
  dayLabel: { ...t.eyebrow, fontSize: 10, color: colors.textMuted },
});
