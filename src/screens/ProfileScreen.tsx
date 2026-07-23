// Profile / You screen
// Avatar (mascot emoji), stats row, settings entries.
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import { MASCOT_EMOJI } from '../data/mascots';
import type { UserProfile } from '../types';

const TONE_LABEL: Record<string, string> = {
  soft: '🕊 Soft',
  direct: '⚡ Direct',
  playful: '✨ Playful',
};

export function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState({ moods: 0, chats: 0, days: 0 });

  // v0.9: re-read on every focus. Without this, after Reset clears
  // AsyncStorage, this screen would still show the old profile + stats
  // until the user manually navigates away and back. useFocusEffect
  // picks up storage events from any tab. See plans/05 P1-13.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const p = await storage.getProfile();
          setProfile(p);
          const moods = await storage.getMoods();
          const chats = await storage.getChats();
          // "DAYS" used to mean "days since account creation" — which is
          // misleading for a user who installed the app, never logged a
          // mood, and saw "100 DAYS" in their stats. Renamed to "ACTIVE
          // DAYS" and computed from distinct mood-dates so the number
          // reflects engagement. The label changed in the JSX below.
          const activeDays = new Set(moods.map((m) => m.date)).size;
          setStats({ moods: moods.length, chats: chats.length, days: activeDays });
        } catch {
          setStats({ moods: 0, chats: 0, days: 0 });
        }
      })();
    }, []),
  );

  // Settings row. When `onPress` is set it's a tappable row with a
  // chevron and a hover state. When unset it's a read-only display row
  // (e.g. "Your mascot" — the value is set during onboarding and not
  // editable in v0; show as plain text so users don't think tapping
  // does something).
  function row(
    icon: string,
    title: string,
    sub?: string,
    onPress?: () => void,
    destructive?: boolean,
  ) {
    const titleColor = destructive ? colors.warn : colors.text;
    if (!onPress) {
      return (
        <View
          style={styles.row}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={`${title}${sub ? `, ${sub}` : ''}`}
        >
          <View style={styles.rowIcon}>
            <Text style={{ fontSize: 18 }}>{icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{title}</Text>
            {sub && <Text style={styles.rowSub}>{sub}</Text>}
          </View>
        </View>
      );
    }
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={sub}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.lavender50 }]}
      >
        <View style={styles.rowIcon}>
          <Text style={{ fontSize: 18 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: titleColor }]}>{title}</Text>
          {sub && <Text style={styles.rowSub}>{sub}</Text>}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  async function exportData() {
    const moods = await storage.getMoods();
    await storage.getChats(); // migrate legacy if present
    const activeId = await storage.getActiveSessionId();
    const active = activeId ? await storage.getChatSession(activeId) : null;
    const chatCount = active?.messages.length ?? 0;
    // v0.5: JSON export is a future-update feature; today the alert
    // surfaces what's on-device so the user understands the volume
    // before the real export ships. (Same Alert.alert pattern as
    // showLegal — placeholder until SettingsScreen ships.)
    Alert.alert(
      'Export data',
      `You have ${moods.length} mood entries and ${chatCount} messages in your current chat. JSON export ships in a future update.`,
    );
  }

  async function reset() {
    // v0.8: disclose the audit log retention in the confirm. The audit
    // log (last 500 entries, schema-versioned, encrypted in SecureStore)
    // intentionally survives clearAll() — it's for safety review, not
    // user data. Users have a right to know what "clears everything"
    // actually means. Plans/05-full-codebase-review-2026-07-22.md P1-8.
    Alert.alert(
      'Reset Fernly?',
      'This clears your profile, mood entries, and chat history on this device. The crisis-pattern audit log (last 500 entries) is retained for safety review and is not user-editable. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await storage.clearAll();
              setProfile(null);
              setStats({ moods: 0, chats: 0, days: 0 });
              // The storage.clearAll() above emits a 'reset' event that
              // RootNav subscribes to. RootNav re-reads the (now-empty)
              // profile and flips onboarded=false, which causes the
              // NavigationContainer to swap the Stack for OnboardingScreen.
              // No nav.reset() needed — the conditional render in RootNav
              // handles the route swap.
            } catch (err) {
              // v0.8: surface deletion failures. Without this, a partial
              // failure silently leaves sensitive data on disk while the
              // user thinks Reset succeeded.
              console.warn('[ProfileScreen] reset failed:', err);
              Alert.alert(
                "Couldn't complete reset",
                'Some data may still be on this device. Try again, and if it keeps failing, restart the app.',
              );
            }
          },
        },
      ],
    );
  }

  function showLegal() {
    // v0.8: be honest about what 'Reset' actually clears. The crisis
    // pattern audit log (last 500 entries) is intentionally retained
    // — it's used for incident response and is NOT considered user
    // content. Saying "clears all your data" while keeping it is a
    // material privacy/trust mismatch.
    Alert.alert(
      'Fernly — legal & safety',
      'Fernly is not therapy. If you are in crisis, contact 988 (US) or 116 123 (UK).\n\nFull Disclaimer, Privacy Policy, and EULA ship in a future update. Open-source decision is on the roadmap.\n\nNote: your local chat history, mood entries, and profile are deleted by Reset. The crisis-pattern audit log (last 500 entries) is retained for safety review and is not user-editable.',
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={{ fontSize: 36 }}>{MASCOT_EMOJI[profile?.mascot || 'moon']}</Text>
        </View>
        <Text style={styles.name}>{profile?.name || '—'}</Text>
        <Text style={styles.subline}>
          {profile ? TONE_LABEL[profile.tone] : ''}
          {profile?.goals?.length ? ` · ${profile.goals.length} GOALS` : ''}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <Stat bg={colors.lavender50} value={String(stats.days)} label="ACTIVE DAYS" />
        <Stat bg={colors.peach50} value={String(stats.moods)} label="MOODS" />
        <Stat bg={colors.mint50} value={String(profile?.goals?.length ?? 0)} label="GOALS" />
      </View>

      <View style={styles.section}>
        {row('🌙', 'Your mascot', profile ? MASCOT_EMOJI[profile.mascot] : undefined)}
        {row('💬', 'Conversation tone', profile?.tone ? TONE_LABEL[profile.tone] : undefined)}
        {row(
          '🎯',
          'Your goals',
          profile?.goals?.length ? `${profile.goals.length} chosen` : 'Not set',
        )}
        {row('📥', 'Export your data', 'Tap to export your data as JSON', exportData)}
        {row('⚖️', 'Legal & safety', 'Tap to read disclaimer, privacy, and EULA', showLegal)}
        {row('🗑', 'Reset Fernly', 'Tap to clear all your data', reset, true)}
      </View>
    </ScreenContainer>
  );
}

function Stat({ bg, value, label }: { bg: string; value: string; label: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: bg }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingTop: space.s7,
    paddingHorizontal: space.s6,
    paddingBottom: space.s5,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.lavender50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.s3,
    borderWidth: 3,
    borderColor: colors.paper2,
  },
  name: { ...t.title, fontSize: 22, color: colors.text, marginBottom: 4 },
  subline: { ...t.eyebrow, color: colors.textMuted },

  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: space.s6, marginBottom: space.s6 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: radius.md },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  statLabel: { ...t.eyebrow, fontSize: 10, color: colors.textMuted, marginTop: 2 },

  section: {
    backgroundColor: colors.paper2,
    marginHorizontal: space.s6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.lavender50,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowTitle: { ...t.body, fontWeight: '600', color: colors.text, fontSize: 15 },
  rowSub: { ...t.small, color: colors.textMuted, marginTop: 2 },
  chevron: { color: colors.ink4, fontSize: 18 },
});
