// Insights — mood graph + auto-detected patterns
// v0: reads from AsyncStorage, draws a real SVG line chart of last 7 days.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { colors, space, type as t } from '../theme';
import { storage } from '../storage';
import { localDateString } from '../util/date';
import type { MoodEntry } from '../types';

export function InsightsScreen() {
  const [moods, setMoods] = useState<MoodEntry[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setMoods(await storage.getMoods());
      } catch {
        setMoods([]);
      }
    })();
  }, []);

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

const styles = StyleSheet.create({
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

  graph: { height: 100, marginVertical: space.s3 },
  emptyGraph: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 36, marginBottom: 6 },
  emptyText: { ...t.small, color: colors.textMuted, textAlign: 'center', maxWidth: 220 },

  dayLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.s3 },
  dayLabel: { ...t.eyebrow, fontSize: 10, color: colors.textMuted },
});
