// Insights — mood graph + auto-detected patterns
// v0: reads from AsyncStorage, draws a real SVG line chart of last 7 days.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card, styles as cardStyles } from '../components/Card';
import { colors, space, type as t } from '../theme';
import { storage } from '../storage';
import type { MoodEntry } from '../types';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function InsightsScreen() {
  const [moods, setMoods] = useState<MoodEntry[]>([]);

  useEffect(() => {
    (async () => setMoods(await storage.getMoods()))();
  }, []);

  // Build last 7 days (oldest left, today right)
  const last7: { day: string; score: number | null; iso: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay(); // 0=Sun
    const found = moods.find((m) => m.date === iso);
    last7.push({ day: DAYS[(dow + 6) % 7], score: found?.score ?? null, iso });
  }

  const filled = last7.filter((d) => d.score !== null) as {
    day: string;
    score: number;
    iso: string;
  }[];
  const avg = filled.length ? filled.reduce((s, m) => s + m.score, 0) / filled.length : null;

  // Render SVG line chart
  const W = 320,
    H = 100,
    PAD = 12;
  const points = filled
    .map((m, i) => {
      const x = PAD + (i / Math.max(filled.length - 1, 1)) * (W - 2 * PAD);
      const y = H - PAD - ((m.score - 1) / 5) * (H - 2 * PAD);
      return `${x},${y}`;
    })
    .join(' ');

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
          {filled.length > 1 ? (
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
              <Line
                x1={PAD}
                y1={H - PAD}
                x2={W - PAD}
                y2={H - PAD}
                stroke={colors.line}
                strokeWidth={1}
              />
              <Polyline
                points={points}
                fill="none"
                stroke={colors.accent}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {filled.map((m, i) => {
                const x = PAD + (i / Math.max(filled.length - 1, 1)) * (W - 2 * PAD);
                const y = H - PAD - ((m.score - 1) / 5) * (H - 2 * PAD);
                return <Circle key={m.iso} cx={x} cy={y} r={5} fill={colors.accent} />;
              })}
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
          {last7.map((d, i) => (
            <Text
              key={i}
              style={[
                styles.dayLabel,
                d.score !== null && { color: colors.text, fontWeight: '700' },
              ]}
            >
              {d.day}
            </Text>
          ))}
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
