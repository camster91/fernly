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
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import { initialMoodLabel as formatInitialMood } from '../components/MoodPicker';
import type { Goal, Mascot, Tone, UserProfile } from '../types';

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

  // v0.10 (issue #59): re-read on every focus, not just mount.
  // Without this, a user who resets Fernly or changes profile
  // settings elsewhere would land on stale data when they
  // return to this screen. The safe read distinguishes
  // "no profile" (legitimate empty) from "read error" so a
  // storage failure doesn't silently mark the form dirty
  // against an outdated baseline.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await storage.getProfileSafe();
        if (cancelled) return;
        if (result.kind === 'error') {
          // Don't clear the form on a read failure — the user
          // may have a real profile sitting in local state and
          // the failure is transient. Show the error inline so
          // they know the next save may also fail.
          setSaveError(`Couldn't read your profile: ${result.reason}. Try again later.`);
          return;
        }
        if (result.kind === 'empty') return;
        setSaveError(null);
        setOriginal(result.profile);
        setMascot(result.profile.mascot);
        setTone(result.profile.tone);
        setGoals([...result.profile.goals]);
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // v0.10 (issue #59): goal comparison now uses set semantics so
  // reordering the user's picks doesn't mark the form dirty.
  // JSON.stringify on a sorted copy is a string-comparison hack
  // that happens to work for string IDs but is fragile (e.g.
  // fails if Goal is ever a numeric enum, fails on a Goal
  // surface that returns IDs in different orders from storage
  // vs UI). The set-based comparison reads more clearly and is
  // explicit about ignoring order.
  function sameGoals(a: Goal[], b: Goal[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    for (const g of b) if (!set.has(g)) return false;
    return true;
  }

  const dirty =
    original &&
    (mascot !== original.mascot ||
      tone !== original.tone ||
      !sameGoals(goals, original.goals));

  const toggleGoal = (id: Goal) =>
    setGoals((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length < 3 ? [...g, id] : g));

  // v0.10 (issue #59): single-flight save with retryable error
  // + unsaved-change preservation. The `saving` flag prevents a
  // double-tap on the Save button from racing the first write;
  // the disabled style on the button reinforces the visual
  // state. A failure leaves `original` unchanged so the form
  // still reflects the unsaved state — the user can retry or
  // close (with the dialog) and pick up exactly where they left
  // off.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!original) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    // Preserve initialMood + initialMoodLabel (issue #80). Both are
    // read-only fields that the user set in onboarding; settings edits
    // mascot/tone/goals and leaves the start-state mood untouched.
    const next: UserProfile = {
      ...original,
      mascot,
      tone,
      goals,
      ...(original.initialMoodLabel
        ? { initialMoodLabel: original.initialMoodLabel }
        : {}),
      ...(original.initialMood !== undefined
        ? { initialMood: original.initialMood }
        : {}),
    };
    try {
      // v0.10 (issue #52): strict variant. A write failure is
      // surfaced inline; the form stays dirty so the user can
      // retry without re-entering their changes.
      await storage.setProfileStrict(next);
      setOriginal(next);
      setSaving(false);
      Alert.alert('Saved', 'Your preferences are updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      setSaving(false);
      setSaveError(
        e instanceof Error
          ? `Couldn't save: ${e.message}. Your changes are still on this screen — try again.`
          : "Couldn't save. Your changes are still on this screen — try again.",
      );
    }
  }, [original, mascot, tone, goals, navigation, saving]);

  const exportData = useCallback(async () => {
    try {
      const moods = await storage.getMoods();
      // v0.10 (issue #52): use the index-walking enumerator so the
      // export actually contains every chat session. Previously
      // getChats() returned the legacy single-blob (and [] for
      // v0.3+ installs) — so a v0.3+ user exporting their data
      // got an empty chats array even though the session was sitting
      // in their keychain.
      const { sessions: chats, unreadable: unreadableChats } = await storage.getAllChatSessions();
      const session = await storage.getActiveSessionId();
      const profile = await storage.getProfile();
      // JSON export — the simplest portable format. Round-trip via
      // storage.import is out of v0 scope (import = a different
      // security audit, different risk model).
      //
      // v0.10 (issue #52): if any chat sessions failed to read, we
      // include an `unreadableChats` field so the user knows the
      // export is partial. Hiding the failure here would mean
      // "Export your data" silently dropped entries.
      const json = JSON.stringify(
        {
          profile,
          moods,
          chats,
          activeSessionId: session,
          exportedAt: new Date().toISOString(),
          ...(unreadableChats.length > 0 ? { unreadableChats } : {}),
        },
        null,
        2,
      );
      await Share.share({
        title: 'Fernly export',
        message: json,
      });
      if (unreadableChats.length > 0) {
        Alert.alert(
          'Export was partial',
          `${unreadableChats.length} chat session(s) couldn't be read and were not included. The export is in the share sheet.`,
        );
      }
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
      'Fernly is not therapy. If you are in crisis, contact 988 (US) or 116 123 (UK).\n\nFull Disclaimer, Privacy Policy, and EULA ship in a future update. Open-source decision is on the roadmap.\n\nNote: your local chat history, mood entries, and profile are deleted by Reset. The crisis-pattern audit log (last 500 entries) is retained for safety review and is not user-editable.',
    );
  }, []);

  // v0.10 (issue #69): always-visible close affordance. Without
  // this, the only way out of the modal is the Android back / iOS
  // swipe-down / Escape key — which a user unfamiliar with the
  // platform gesture may not discover. The button calls attemptClose
  // which routes the dirty state through the standard
  // Save/Discard/Keep-editing dialog (or just closes if clean).
  function attemptClose() {
    if (!dirty) {
      navigation.goBack();
      return;
    }
    Alert.alert(
      'You have unsaved changes',
      'Save your changes, discard them, or keep editing?',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
        {
          text: 'Save',
          onPress: async () => {
            // Re-use the same save() path. setProfileStrict
            // (issue #52) throws on write failure, in which case
            // the screen stays mounted and the unsaved state is
            // preserved so the user can retry.
            try {
              await save();
            } catch {
              Alert.alert(
                "Couldn't save",
                'Your changes are still on this screen. Try again, or tap Close and choose Discard to leave without saving.',
              );
            }
          },
        },
      ],
    );
  }

  return (
    // v0.10 (issue #62): the ScreenContainer owns vertical
    // scrolling. The previous version had ScreenContainer
    // (which scrolls) wrapping a ScrollView — two nested
    // scroll owners meant the outer one intercepted gestures
    // and the inner one never received them, so the screen
    // effectively couldn't scroll past the first card on
    // short viewports. Removed the inner ScrollView; the
    // ScreenContainer handles the entire content.
    <ScreenContainer scroll>
        <View style={styles.header}>
          {/* v0.10 (issue #69): visible close button at the top of
              the header so the user has a deterministic exit
              affordance before reaching the bottom Save button. */}
          <View style={styles.headerTop}>
            <Text style={styles.eyebrow}>SETTINGS</Text>
            <Pressable
              onPress={attemptClose}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              accessibilityHint={
                dirty
                  ? 'You have unsaved changes. Opens a save/discard dialog.'
                  : 'Closes the settings screen'
              }
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
          {/* v0.10 (issue #82): header semantics for screen-reader rotor. */}
          <Text style={styles.title} accessibilityRole="header">
            Your preferences
          </Text>
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
        {original && (original.initialMoodLabel || original.initialMood !== undefined) && (
          <Card>
            <Text style={styles.sectionLabel}>MOOD WHEN YOU STARTED</Text>
            <Text style={styles.sub}>
              {/* v0.10 (issue #80): show the verbatim word the user picked
                  in onboarding, not a score-derived label. */}
              {formatInitialMood(original) ?? 'Unknown'} (set during onboarding)
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

        {/* v0.10 (issue #59): inline save error with retry. The
            error keeps the form dirty so the user can re-tap Save
            without re-entering their changes. Renders above the
            save CTA so the user sees it before tapping. */}
        {saveError && (
          <View
            style={styles.saveErrorBanner}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            <Text style={styles.saveErrorText}>{saveError}</Text>
          </View>
        )}

        <Pressable
          onPress={save}
          disabled={!dirty || saving}
          accessibilityRole="button"
          accessibilityLabel={
            saving
              ? 'Saving changes'
              : dirty
                ? 'Save changes'
                : 'No changes yet'
          }
          accessibilityState={{ disabled: !dirty || saving, busy: saving }}
          style={({ pressed }) => [
            styles.saveCta,
            (!dirty || saving) && styles.saveCtaDisabled,
            pressed && !saving && styles.saveCtaPressed,
          ]}
        >
          <Text style={styles.saveCtaText}>
            {saving
              ? 'Saving…'
              : dirty
                ? 'Save changes'
                : 'No changes yet'}
          </Text>
        </Pressable>
    </ScreenContainer>
  );
}

// v0.10 (issue #80): the local `initialMoodLabel` helper is gone.
// The screen now uses the canonical `initialMoodLabel` from
// `components/MoodPicker.tsx` (imported as `formatInitialMood` to
// avoid shadowing the imported symbol). The local copy was a
// score-derived label that didn't match the word the user picked.

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.s6, paddingTop: space.s6, paddingBottom: space.s4 },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eyebrow: { ...t.eyebrow, color: colors.lavender700 },
  // v0.10 (issue #69): close button. 44pt min height for tap
  // target compliance (WCAG 2.5.5). Text-only so it doesn't fight
  // the screen's pastel aesthetic.
  closeBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  closeBtnText: { ...t.bodyBold, color: colors.lavender700, fontSize: 14 },
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

  saveErrorBanner: {
    marginHorizontal: space.s6,
    marginBottom: space.s2,
    backgroundColor: colors.rose50,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.rose100,
  },
  saveErrorText: { ...t.small, color: colors.warn, textAlign: 'center' },

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
