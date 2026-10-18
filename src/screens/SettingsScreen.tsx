// Settings — edit mascot / tone / goals, export your data, see legal &
// safety info, send feedback. Reachable from ProfileScreen's
// actionable rows; routed via RootStackParamList.Settings.
//
// v0.9 ships this as the real screen after plans/05 P1-20 caught that
// ProfileScreen was opening Alert.alerts for "Export your data" and
// "Legal & safety" — both visibly-tappable rows going nowhere. Now
// they actually navigate.
//
// Edit pattern: changes are staged in local state and only persisted
// on "Save". Reuses Card + the same visual tokens as elsewhere —
// no new design surfaces.
import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import type { Goal, Mascot, MoodScore, Tone, UserProfile } from '../types';

type Props = {
  navigation: { goBack: () => void };
};

const MASCOTS: { id: Mascot; emoji: string }[] = [
  { id: 'moon', emoji: '🌙' },
  { id: 'fox', emoji: '🦊' },
  { id: 'turtle', emoji: '🐢' },
  { id: 'bee', emoji: '🐝' },
];

const TONES: { id: Tone; label: string; sample: string }[] = [
  { id: 'soft', label: 'Soft', sample: 'Want to sit with it together?' },
  { id: 'direct', label: 'Direct', sample: "Let's do the thought record." },
  { id: 'playful', label: 'Playful', sample: 'your brain is doing the thing again lol' },
];

const GOALS: { id: Goal; label: string }[] = [
  { id: 'sleep', label: 'Sleep better' },
  { id: 'quiet_thoughts', label: 'Quiet my thoughts' },
  { id: 'less_anxious', label: 'Feel less anxious' },
  { id: 'self_kindness', label: 'Be kinder to me' },
  { id: 'process_feelings', label: 'Process feelings' },
  { id: 'build_habit', label: 'Build a habit' },
  { id: 'just_explore', label: 'Just see' },
];

export function SettingsScreen({ navigation }: Props) {
  const [original, setOriginal] = useState<UserProfile | null>(null);
  const [mascot, setMascot] = useState<Mascot>('moon');
  const [tone, setTone] = useState<Tone>('soft');
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    (async () => {
      const p = await storage.getProfile();
      if (!p) return;
      setOriginal(p);
      setMascot(p.mascot);
      setTone(p.tone);
      setGoals([...p.goals]);
    })();
  }, []);

  const dirty =
    original &&
    (mascot !== original.mascot ||
      tone !== original.tone ||
      JSON.stringify(goals) !== JSON.stringify([...original.goals].sort()));

  const toggleGoal = (id: Goal) =>
    setGoals((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length < 3 ? [...g, id] : g));

  const save = useCallback(async () => {
    if (!original) return;
    // Preserve initialMood if present (added in plans/05 P1-15;
    // some older profiles may not have it). Read via index access
    // with a type guard to keep the SettingsScreen independent of
    // that branch's UserProfile change.
    const next: UserProfile = {
      ...original,
      mascot,
      tone,
      goals,
      ...(('initialMood' in original && original.initialMood
        ? { initialMood: original.initialMood }
        : {}) as Partial<UserProfile>),
    };
    await storage.setProfile(next);
    setOriginal(next);
    Alert.alert('Saved', 'Your preferences are updated.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  }, [original, mascot, tone, goals, navigation]);

  const exportData = useCallback(async () => {
    try {
      const moods = await storage.getMoods();
      const chats = await storage.getAllChatSessions();
      const session = await storage.getActiveSessionId();
      const profile = await storage.getProfile();
      // JSON export — the simplest portable format. Round-trip via
      // storage.import is out of v0 scope (import = a different
      // security audit, different risk model).
      const json = JSON.stringify(
        { profile, moods, chats, activeSessionId: session, exportedAt: new Date().toISOString() },
        null,
        2,
      );
      await Share.share({
        title: 'Fernly export',
        message: json,
      });
    } catch (err) {
      Alert.alert(
        "Couldn't export",
        'Some data may not be included. Try again, and if it keeps failing, restart the app.',
      );
      console.warn('[SettingsScreen] export failed:', err);
    }
  }, []);

  const showLegal = useCallback(() => {
    Alert.alert(
      'Fernly — legal & safety',
      'Fernly is not therapy. If you are in crisis, contact 988 (US) or 116 123 (UK).\n\nFull Disclaimer, Privacy Policy, and EULA ship in a future update. Open-source decision is on the roadmap.\n\nNote: your local mood entries, profile, and any older saved conversations are deleted by Reset. The crisis-pattern audit log (last 500 entries) is retained for safety review and is not user-editable.',
    );
  }, []);

  return (
    <ScreenContainer scroll>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>SETTINGS</Text>
          <Text style={styles.title}>Your preferences</Text>
          <Text style={styles.sub}>
            Change your mascot, tone, or goals. Changes save with the button at the bottom.
          </Text>
        </View>

        {/* Mascot picker — 4 emoji cards. Bound state, no save until bottom. */}
        <Card>
          <Text style={styles.sectionLabel}>MASCOT</Text>
          <View style={styles.row}>
            {MASCOTS.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setMascot(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${m.id} as your friend mascot`}
                accessibilityState={{ selected: mascot === m.id }}
                style={[styles.choice, mascot === m.id && styles.choiceActive]}
              >
                <Text style={styles.choiceEmoji}>{m.emoji}</Text>
                <Text style={[styles.choiceLabel, mascot === m.id && styles.choiceLabelActive]}>
                  {m.id}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Tone picker — 3 rows. */}
        <Card>
          <Text style={styles.sectionLabel}>TONE</Text>
          {TONES.map((tn) => (
            <Pressable
              key={tn.id}
              onPress={() => setTone(tn.id)}
              accessibilityRole="button"
              accessibilityLabel={`Set tone to ${tn.label}`}
              accessibilityState={{ selected: tone === tn.id }}
              style={[styles.toneRow, tone === tn.id && styles.toneRowActive]}
            >
              <Text style={styles.toneLabel}>{tn.label}</Text>
              <Text style={styles.toneSample}>"{tn.sample}"</Text>
            </Pressable>
          ))}
        </Card>

        {/* Goals — multi-select, max 3. */}
        <Card>
          <Text style={styles.sectionLabel}>GOALS · {goals.length}/3</Text>
          {GOALS.map((g) => {
            const picked = goals.includes(g.id);
            return (
              <Pressable
                key={g.id}
                onPress={() => toggleGoal(g.id)}
                accessibilityRole="button"
                accessibilityLabel={`Toggle goal: ${g.label}`}
                accessibilityState={{ selected: picked }}
                style={[styles.goalRow, picked && styles.goalRowActive]}
              >
                <Text style={[styles.goalLabel, picked && styles.goalLabelActive]}>{g.label}</Text>
              </Pressable>
            );
          })}
          {goals.length >= 3 && (
            <Text style={styles.helperText}>Three goals max — unpick one to choose another.</Text>
          )}
        </Card>

        {/* Initial mood — read-only display when present.
            Surfaced for transparency but not editable (would lose
            the "you said X when you signed up" Today greeting). */}
        {original && 'initialMood' in original && original.initialMood !== undefined && (
          <Card>
            <Text style={styles.sectionLabel}>MOOD WHEN YOU STARTED</Text>
            <Text style={styles.sub}>
              {initialMoodLabel((original.initialMood as MoodScore | undefined) ?? 4)} (set during
              onboarding)
            </Text>
          </Card>
        )}

        {/* Action rows match the ProfileScreen list so the navigation
            path from Profile → Settings is linear and consistent. */}
        <Card>
          <Pressable
            onPress={exportData}
            accessibilityRole="button"
            accessibilityLabel="Export your data"
            accessibilityHint="Shares a JSON dump of your profile, moods, and chats"
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={styles.actionText}>Export your data</Text>
          </Pressable>
          <Pressable
            onPress={showLegal}
            accessibilityRole="button"
            accessibilityLabel="Legal and safety info"
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={styles.actionText}>Legal & safety</Text>
          </Pressable>
        </Card>

        <Pressable
          onPress={save}
          disabled={!dirty}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled: !dirty }}
          style={({ pressed }) => [
            styles.saveCta,
            !dirty && styles.saveCtaDisabled,
            pressed && styles.saveCtaPressed,
          ]}
        >
          <Text style={styles.saveCtaText}>{dirty ? 'Save changes' : 'No changes yet'}</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

function initialMoodLabel(score: MoodScore): string {
  // Mirrors moodLabel in components/MoodPicker.tsx — kept local to
  // avoid a circular import via MoodPicker for a single row.
  if (score >= 5) return 'Hopeful';
  if (score >= 4) return 'Okay';
  if (score >= 3) return 'Steady';
  if (score >= 2) return 'Heavy';
  return 'Low';
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.s6, paddingTop: space.s6, paddingBottom: space.s4 },
  eyebrow: { ...t.eyebrow, color: colors.lavender700, marginBottom: 6 },
  title: { ...t.title, fontSize: 26, color: colors.text, marginBottom: 6 },
  sub: { ...t.body, color: colors.textSoft, lineHeight: 22 },

  sectionLabel: {
    ...t.eyebrow,
    color: colors.lavender700,
    marginBottom: space.s3,
  },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: space.s3 },
  choice: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.lavender100,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.lavender100,
  },
  choiceActive: { borderColor: colors.ink, backgroundColor: colors.lavender50 },
  choiceEmoji: { fontSize: 32, marginBottom: 4 },
  choiceLabel: { ...t.small, color: colors.text, fontWeight: '600' },
  choiceLabelActive: { color: colors.ink },

  toneRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  toneRowActive: { borderColor: colors.ink, backgroundColor: colors.lavender50 },
  toneLabel: { ...t.bodyBold, color: colors.text },
  toneSample: { ...t.small, color: colors.textSoft, marginTop: 2 },

  goalRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 8,
    backgroundColor: colors.lavender100,
    borderWidth: 1,
    borderColor: colors.lavender100,
  },
  goalRowActive: { backgroundColor: colors.lavender50, borderColor: colors.ink },
  goalLabel: { ...t.body, color: colors.text },
  goalLabelActive: { color: colors.ink, fontWeight: '600' },
  helperText: { ...t.small, color: colors.textMuted, marginTop: 4 },

  action: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  actionPressed: { opacity: 0.85 },
  actionText: { ...t.body, color: colors.text },

  saveCta: {
    marginHorizontal: space.s6,
    marginTop: space.s5,
    backgroundColor: colors.ink,
    paddingVertical: 18,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  saveCtaDisabled: { backgroundColor: colors.ink4 },
  saveCtaPressed: { opacity: 0.85 },
  saveCtaText: { ...t.bodyBold, color: colors.paper },
});
