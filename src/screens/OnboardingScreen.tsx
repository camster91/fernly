// Onboarding — 5 questions, then save profile + done.
//   1. Name
//   2. Mood self-ID
//   3. Goals (multi-select, max 3)
//   4. Mascot picker
//   5. Tone selector
// Open beta: no paywall, no reminders ask, no privacy gate — we ship the lightest possible path.
//
// v0.10 (issue #76): MASCOTS / TONES / GOALS / MOOD_CHOICES used
// to be defined inline here AND in SettingsScreen, drifting over
// time. Now they're consolidated in `src/data/preferences.ts` as
// the single source of truth. This screen consumes the
// `onboardingLabel` / `onboardingSample` variants for the
// first-touch picker; SettingsScreen uses the plain `label` /
// `sample` variants.
import React, { useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Pill } from '../components/Pill';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import type { Mascot, MoodId, Tone, UserProfile } from '../types';
import {
  MASCOTS,
  MOOD_CHOICES,
  TONES,
  moodById,
} from '../data/preferences';

interface Props {
  onDone: () => void;
}

export function OnboardingScreen({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  // v0.10 (issue #80): track the choice by stable MoodId so the picked
  // label round-trips to Today / Settings. The score is derived at save
  // time from the chosen MoodId entry.
  const [mood, setMood] = useState<MoodId | null>(null);
  // v0.10 (issue #57): single-flight save state. Without this, a rapid
  // double-tap on "Begin" (or a tap + the keyboard's Return key) would
  // call setProfile twice. The second call can race the first and the
  // profile can end up with a half-written goals array.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // v0.10 (issue #71): the goals picker step was removed; the
  // onboarding flow no longer collects goals. The field is still
  // persisted (as []) for type compatibility with v0.9 profiles
  // and for SettingsScreen's read-only display of existing goals.
  const [mascot, setMascot] = useState<Mascot>('moon');
  const [tone, setTone] = useState<Tone>('soft');

  // v0.10 (issue #71): the goals step was removed because
  // the field has no observable use — the Practice tab doesn't
  // prioritize exercises by goal, the Insights tab doesn't
  // surface goal-based themes, and the chat doesn't reference
  // the goal at all. Asking the user for goals and then ignoring
  // them is a privacy + trust failure (the plans/01 product
  // plan deferred this to a future exercise-recs feature,
  // tracked in #42). The stored `goals` field is kept for
  // backward compatibility with v0.9 profiles; new profiles
  // persist `goals: []`. The Settings screen still shows the
  // existing goals as read-only so the user can see what
  // they previously picked.
  const total = 4;
  function next() {
    // v0.8: trigger save() at `total - 1` (= 4) so the "Begin" button on
    // step 5 (the last step) calls save() instead of advancing to a
    // blank step 6. Previously `step < total` left an off-by-one where
    // tapping "Begin" on step 4 (the last step with content) set step to
    // 5, no JSX rendered, and the user was stuck on a blank screen.
    // See plans/05-full-codebase-review-2026-07-22.md P0-2.
    //
    // v0.10 (issue #57): if a save is already in flight, ignore the tap.
    // The CTA also disables via `saving` state but a tap registered just
    // before that state flipped would still hit this path. The guard is
    // a belt-and-suspenders.
    if (saving) return;
    if (step < total - 1) setStep((s) => s + 1);
    else save();
  }
  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  async function save() {
    // v0.10 (issue #57): single-flight save. If a save is already
    // in-flight (rapid double-tap, keyboard Return + tap) the second
    // call is a no-op. Without this guard the user can end up with a
    // half-written profile when the second save lands before the
    // first completes.
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    // Derive the score from the chosen MoodId. The user's text label
    // round-trips as `initialMoodLabel` so Today can re-greet with the
    // word they actually picked (issue #80).
    const picked = mood ? moodById(mood) : null;
    const profile: UserProfile = {
      name: name || 'Friend',
      mascot,
      tone,
      // v0.10 (issue #71): the goals field is no longer
      // collected during onboarding. New profiles start with an
      // empty goals array. The field is kept on the type for
      // backward compat with v0.9 profiles (which SettingsScreen
      // still displays read-only).
      goals: [],
      onboarded: true,
      createdAt: new Date().toISOString(),
      // v0.9: persist the score. Retained for backward compatibility
      // and for callers that need a numeric value (insights chart etc.).
      initialMood: picked?.score,
      // v0.10 (issue #80): the verbatim text the user tapped. The
      // screen round-trips this through to Today and Settings so the
      // user sees the same word they picked. Migrated profiles
      // (initialMoodLabel undefined) fall back to moodLabel(score) in
      // the consumer screens.
      initialMoodLabel: picked?.text,
    };
    try {
      // v0.10 (issue #52): use the strict variant so a write failure
      // is not silently swallowed. The legacy setProfile() would
      // catch and discard AsyncStorage errors, letting the parent
      // route into the main tabs without a successful save.
      await storage.setProfileStrict(profile);
      // Success: leave the saving flag set (we're about to unmount via
      // onDone) and call the parent's completion handler. The parent
      // navigates to the main tabs.
      onDone();
    } catch (e) {
      // v0.10 (issue #57): surface the failure inline and keep the
      // entered answers so the user can retry without re-onboarding.
      // Previously the failure was swallowed by storage.setProfile and
      // onDone was called regardless — a silent data-loss path.
      setSaving(false);
      setSaveError(
        e instanceof Error
          ? `Couldn't save your profile: ${e.message}. Try again.`
          : "Couldn't save your profile. Try again.",
      );
    }
  }

  const canAdvance = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return mood !== null;
    if (step === 2) return true; // mascot has default
    if (step === 3) return true; // tone has default
    return true;
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.dots} accessible={false} accessibilityElementsHidden>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < step && styles.dotDone, i === step && styles.dotActive]}
          />
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <Step title="What should Fernly call you?" eyebrow="STEP 1 OF 5">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="First name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              style={styles.input}
              returnKeyType="next"
              onSubmitEditing={next}
              accessibilityLabel="Your first name"
              accessibilityHint="What Fernly should call you in the app"
            />
          </Step>
        )}

        {step === 1 && (
          <Step title="Right now, what's closest?" eyebrow="STEP 2 OF 4">
            <Text style={styles.sub}>Helps Fernly meet you where you are.</Text>
            <View style={styles.pillRow}>
              {MOOD_CHOICES.map((m) => (
                // v0.10 (issue #75): migrated to the shared Pill
                // primitive. The old hand-rolled Pressable+Text
                // duplicated the contrast + 2px border + 700-weight
                // selected state. Pill centralizes that.
                <Pill
                  key={m.id}
                  label={m.text}
                  selected={mood === m.id}
                  onPress={() => setMood(m.id)}
                  size="medium"
                />
              ))}
            </View>
          </Step>
        )}

        {step === 2 && (
          <Step title="Pick a friend." eyebrow="STEP 3 OF 4">
            <Text style={styles.sub}>This is who you'll chat with.</Text>
            <View style={styles.mascotGrid}>
              {MASCOTS.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setMascot(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${m.id} as your friend mascot`}
                  accessibilityState={{ selected: mascot === m.id }}
                  style={[styles.mascotBox, mascot === m.id && styles.mascotBoxActive]}
                >
                  <Text style={styles.mascotEmoji}>{m.emoji}</Text>
                </Pressable>
              ))}
            </View>
          </Step>
        )}

        {step === 3 && (
          <Step title="How should Fernly talk?" eyebrow="STEP 4 OF 4">
            {/* v0.9: "Change anytime in settings" was a lie in v0.8 —
                settings is forward-compatible (Settings route is reserved
                in RootStackParamList) but not yet shipped. Real options
                are: (a) reset Fernly and re-onboard, or (b) wait for v1.
                See plans/05 P1-20. */}
            <Text style={styles.sub}>Change anytime by resetting Fernly from your Profile.</Text>
            <View style={{ gap: 10 }}>
              {TONES.map((tn) => (
                <Pressable
                  key={tn.id}
                  onPress={() => setTone(tn.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${tn.onboardingLabel} tone. ${tn.onboardingSample}`}
                  accessibilityState={{ selected: tone === tn.id }}
                  style={[
                    styles.toneCard,
                    { backgroundColor: tn.bg },
                    tone === tn.id && styles.toneCardActive,
                  ]}
                >
                  <Text style={styles.toneLabel}>{tn.onboardingLabel}</Text>
                  <Text style={styles.toneSample}>{tn.onboardingSample}</Text>
                </Pressable>
              ))}
            </View>
          </Step>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 && (
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel="Go back to the previous step"
            disabled={saving}
            style={styles.back}
          >
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        )}
        <Pressable
          onPress={next}
          disabled={!canAdvance() || saving}
          accessibilityRole="button"
          accessibilityLabel={
            saving
              ? 'Saving your profile'
              : step === total - 1
                ? 'Begin using Fernly'
                : 'Continue to the next step'
          }
          accessibilityState={{ disabled: !canAdvance() || saving, busy: saving }}
          style={({ pressed }) => [
            styles.cta,
            (!canAdvance() || saving) && styles.ctaDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.ctaText}>
            {saving ? 'Saving…' : step === total - 1 ? 'Begin' : 'Next'}
          </Text>
        </Pressable>
      </View>

      {/* v0.10 (issue #57): inline save error with retry. The entered
          answers remain in component state, so a retry calls save()
          again with the same data. */}
      {saveError && (
        <View
          style={styles.errorBanner}
          accessible={true}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.errorText}>{saveError}</Text>
          <Pressable
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="Retry saving your profile"
            style={({ pressed }) => [styles.retryCta, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.retryCtaText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </ScreenContainer>
  );
}

function Step({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  // v0.10 (issue #82): announce the new step to screen readers once it
  // mounts. Without this, TalkBack/VoiceOver users have no deterministic
  // signal that the step changed — the new content is just swapped in
  // place. The announcement is brief and role-neutral so it doesn't
  // interrupt a reading flow.
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${eyebrow}. ${title}`);
  }, [eyebrow, title]);
  return (
    <View style={styles.stepWrap}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      {/* v0.10 (issue #82): the step title carries header semantics so
          VoiceOver/TalkBack announces "Heading: {title}" when the
          user rotors to it. Combined with the announceForAccessibility
          above, this gives screen-reader users a deterministic signal
          that the step changed. */}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepWrap: { paddingHorizontal: space.s6, paddingTop: space.s7 },
  eyebrow: { ...t.eyebrow, color: colors.lavender700, marginBottom: space.s2 },
  title: { ...t.displayLg, color: colors.text, marginBottom: space.s3 },
  sub: { ...t.body, color: colors.textSoft, marginBottom: space.s5 },

  input: {
    backgroundColor: colors.paper2,
    borderRadius: radius.md,
    padding: 16,
    fontSize: 18,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.line,
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  // v0.10 (issue #81): selected pill uses the new `accentSelected`
  // token (#6B4FB0, lavender700) with paper text — measures 8.6:1
  // contrast (passes WCAG AA-body 4.5:1). The legacy `accent` was
  // 3.18:1, failing AA. Combined with a 2px border (vs 1px on
  // unselected) the SHAPE differs in addition to color, giving
  // color-blind users a non-color cue.
  pillActive: {
    backgroundColor: colors.accentSelected,
    borderColor: colors.accentSelected,
    borderWidth: 2,
    paddingHorizontal: 15, // keep visual size constant when border doubles
  },
  pillText: { fontSize: 14, fontWeight: '600', color: colors.text },
  pillTextActive: { color: colors.accentSelectedText, fontWeight: '700' },

  mascotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mascotBox: {
    width: '48%',
    aspectRatio: 1,
    backgroundColor: colors.lavender50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  mascotBoxActive: { borderColor: colors.accent },
  mascotEmoji: { fontSize: 48 },

  toneCard: { padding: 14, borderRadius: radius.md, borderWidth: 2, borderColor: 'transparent' },
  toneCardActive: { borderColor: colors.accent },
  toneLabel: { fontWeight: '700', fontSize: 16, color: colors.text, marginBottom: 4 },
  toneSample: { fontSize: 13, color: colors.textSoft, fontStyle: 'italic' },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: space.s7,
    paddingBottom: space.s3,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotDone: { backgroundColor: colors.mint300 },
  dotActive: { backgroundColor: colors.accent, width: 22, borderRadius: 4 },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.s6,
    paddingTop: 12,
    paddingBottom: 32,
    backgroundColor: colors.bg,
    flexDirection: 'row',
    gap: 12,
  },
  back: { paddingVertical: 16, paddingHorizontal: 20 },
  backText: { ...t.bodyBold, color: colors.textSoft },
  cta: {
    flex: 1,
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    paddingVertical: 18,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: colors.ink4 },
  ctaText: { color: colors.paper, fontWeight: '700', fontSize: 16 },

  // v0.10 (issue #57): inline error banner + retry CTA. Sits just above
  // the footer so it's reachable without scrolling. The accessible role
  // and live region announce the failure to screen readers as soon as
  // it appears.
  errorBanner: {
    position: 'absolute',
    bottom: 96,
    left: space.s6,
    right: space.s6,
    backgroundColor: colors.rose50,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.rose100,
    alignItems: 'center',
  },
  errorText: { ...t.small, color: colors.warn, textAlign: 'center', marginBottom: 8 },
  retryCta: {
    backgroundColor: colors.warnDeep,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.full,
  },
  retryCtaText: { color: colors.paper, fontWeight: '700', fontSize: 14 },
});
