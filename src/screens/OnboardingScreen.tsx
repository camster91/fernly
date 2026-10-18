// Onboarding — 6 steps, then save profile + done.
//   0. Before we start (18+ confirmation)
//   1. Name
//   2. Mood self-ID
//   3. Goals (multi-select, max 3)
//   4. Mascot picker
//   5. Tone selector
// Open beta: no paywall, no reminders ask, no privacy gate — we ship the lightest possible path.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import type { Goal, Mascot, MoodScore, Tone, UserProfile } from '../types';

// v0.9: changed `MOOD_CHOICES` from string[] to { label: MoodScore, text }
// so the onboarding pick is persisted as a real score (1-6), not a free-
// text string nobody reads. TodayScreen can greet the user with their
// starting mood on first launch. See plans/05 P1-15.
const MOOD_CHOICES: { label: MoodScore; text: string }[] = [
  { label: 2, text: 'Anxious' },
  { label: 1, text: 'Numb' },
  { label: 2, text: 'Tired' },
  { label: 5, text: 'Hopeful' },
  { label: 2, text: 'Overwhelmed' },
  { label: 4, text: 'Okay' },
  { label: 2, text: 'Lonely' },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: 'sleep', label: '💤 Sleep better' },
  { id: 'quiet_thoughts', label: '🧠 Quiet my thoughts' },
  { id: 'less_anxious', label: '💪 Feel less anxious' },
  { id: 'self_kindness', label: '❤️ Be kinder to me' },
  { id: 'process_feelings', label: '📓 Process feelings' },
  { id: 'build_habit', label: '✨ Build a habit' },
  { id: 'just_explore', label: '🎯 Just see' },
];
const MASCOTS: { id: Mascot; emoji: string }[] = [
  { id: 'moon', emoji: '🌙' },
  { id: 'fox', emoji: '🦊' },
  { id: 'turtle', emoji: '🐢' },
  { id: 'bee', emoji: '🐝' },
];
const TONES: { id: Tone; label: string; sample: string; bg: string }[] = [
  {
    id: 'soft',
    label: '🕊 Soft',
    sample: '"That sounds heavy. Want to sit with it?"',
    bg: colors.lavender50,
  },
  {
    id: 'direct',
    label: '⚡ Direct',
    sample: '"Let\'s do the thought record. 3 minutes."',
    bg: colors.peach50,
  },
  {
    id: 'playful',
    label: '✨ Playful',
    sample: '"your brain is doing the thing again lol"',
    bg: colors.yellow50,
  },
];

interface Props {
  onDone: () => void;
}

export function OnboardingScreen({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [adult, setAdult] = useState(false);
  const [name, setName] = useState('');
  // v0.9: MoodScore (1-6) instead of free-text string. Previously the
  // picked mood was discarded — kept as a 'string | null' with no
  // receiver. Now it persists as initialMood on the profile. See P1-15.
  const [mood, setMood] = useState<MoodScore | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [mascot, setMascot] = useState<Mascot>('moon');
  const [tone, setTone] = useState<Tone>('soft');

  const total = 6;
  function next() {
    // v0.8: trigger save() at `total - 1` (= 4) so the "Begin" button on
    // step 5 (the last step) calls save() instead of advancing to a
    // blank step 6. Previously `step < total` left an off-by-one where
    // tapping "Begin" on step 4 (the last step with content) set step to
    // 5, no JSX rendered, and the user was stuck on a blank screen.
    // See plans/05-full-codebase-review-2026-07-22.md P0-2.
    if (step < total - 1) setStep((s) => s + 1);
    else save();
  }
  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  function toggleGoal(id: Goal) {
    setGoals((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length < 3 ? [...g, id] : g));
  }

  async function save() {
    const profile: UserProfile = {
      name: name || 'Friend',
      mascot,
      tone,
      goals,
      onboarded: true,
      createdAt: new Date().toISOString(),
      // v0.9: persist the onboarding mood pick so it can be surfaced
      // on the Today greeting instead of being collected and discarded.
      // See plans/05 P1-15.
      initialMood: mood ?? undefined,
    };
    await storage.setProfile(profile);
    onDone();
  }

  const canAdvance = () => {
    if (step === 0) return adult;
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return mood !== null;
    if (step === 3) return goals.length > 0;
    if (step === 4) return true; // mascot has default
    if (step === 5) return true; // tone has default
    return true;
  };

  return (
    <ScreenContainer scroll={false} showHelp={false}>
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
          <Step title="Before we start" eyebrow="STEP 1 OF 6">
            <Text style={styles.sub}>Fernly is free forever. No ads. No account.</Text>
            <Pressable
              onPress={() => setAdult((a) => !a)}
              accessibilityRole="checkbox"
              accessibilityLabel="I'm 18 or older"
              accessibilityState={{ checked: adult }}
              style={styles.checkRow}
            >
              <View style={[styles.checkBox, adult && styles.checkBoxOn]}>
                {adult && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>I'm 18 or older</Text>
            </Pressable>
          </Step>
        )}

        {step === 1 && (
          <Step title="What should Fernly call you?" eyebrow="STEP 2 OF 6">
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

        {step === 2 && (
          <Step title="Right now, what's closest?" eyebrow="STEP 3 OF 6">
            <Text style={styles.sub}>Helps Fernly meet you where you are.</Text>
            <View style={styles.pillRow}>
              {MOOD_CHOICES.map((m) => (
                <Pressable
                  key={m.text}
                  onPress={() => setMood(m.label)}
                  accessibilityRole="button"
                  accessibilityLabel={m.text}
                  accessibilityState={{ selected: mood === m.label }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={[styles.pill, mood === m.label && styles.pillActive]}
                >
                  <Text style={[styles.pillText, mood === m.label && styles.pillTextActive]}>
                    {m.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Step>
        )}

        {step === 3 && (
          <Step title="What are you hoping for?" eyebrow="STEP 4 OF 6">
            <Text style={styles.sub}>Pick up to 3.</Text>
            <View style={styles.pillRow}>
              {GOALS.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => toggleGoal(g.id)}
                  accessibilityRole="button"
                  accessibilityLabel={g.label}
                  accessibilityState={{ selected: goals.includes(g.id) }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={[styles.pill, goals.includes(g.id) && styles.pillActive]}
                >
                  <Text style={[styles.pillText, goals.includes(g.id) && styles.pillTextActive]}>
                    {g.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Step>
        )}

        {step === 4 && (
          <Step title="Pick a friend." eyebrow="STEP 5 OF 6">
            <Text style={styles.sub}>This is your companion in the app.</Text>
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

        {step === 5 && (
          <Step title="How should Fernly talk?" eyebrow="STEP 6 OF 6">
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
                  accessibilityLabel={`${tn.label} tone. ${tn.sample}`}
                  accessibilityState={{ selected: tone === tn.id }}
                  style={[
                    styles.toneCard,
                    { backgroundColor: tn.bg },
                    tone === tn.id && styles.toneCardActive,
                  ]}
                >
                  <Text style={styles.toneLabel}>{tn.label}</Text>
                  <Text style={styles.toneSample}>{tn.sample}</Text>
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
            style={styles.back}
          >
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        )}
        <Pressable
          onPress={next}
          disabled={!canAdvance()}
          accessibilityRole="button"
          accessibilityLabel={
            step === total - 1 ? 'Begin using Fernly' : 'Continue to the next step'
          }
          accessibilityState={{ disabled: !canAdvance() }}
          style={({ pressed }) => [
            styles.cta,
            !canAdvance() && styles.ctaDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.ctaText}>{step === total - 1 ? 'Begin' : 'Next'}</Text>
        </Pressable>
      </View>
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
  return (
    <View style={styles.stepWrap}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
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

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  checkBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.paper2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.paper, fontWeight: '800', fontSize: 16 },
  checkLabel: { ...t.bodyBold, color: colors.text },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontSize: 14, fontWeight: '600', color: colors.text },
  pillTextActive: { color: colors.paper },

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
});
