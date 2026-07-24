// Card primitive — the workhorse component.
// Variants: default (paper-on-paper), soft (pastel), with optional press handler.
//
// a11y: when `onPress` is set, the card is rendered as a Pressable with
// accessibilityRole='button'. Callers MUST pass `accessibilityLabel` to
// describe the action (e.g. "Open Mood check-in"). When `onPress` is unset
// the card is purely presentational.
//
// Also exports a `styles` const with eyebrow/title/sub text styles. Three
// callers (TodayScreen, InsightsScreen, PracticeScreen) consume both the
// component and the styles via `import { Card, styles as cardStyles }`.
// A compound `Card.Header` / `Card.Title` / `Card.Sub` refactor would
// eliminate the alias but require touching all 3 callers + MoodCheckIn +
// OnboardingScreen + ProfileScreen. Out of scope for the polish pass;
// tracked as P3 #39 for a future cleanup PR.
import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

type Variant = 'default' | 'soft' | 'peach' | 'mint' | 'yellow' | 'rose';

interface Props {
  variant?: Variant;
  onPress?: () => void;
  /**
   * Required when `onPress` is set. Describes the action to VoiceOver /
   * TalkBack. Example: 'Open Mood check-in'. TypeScript-enforced at the
   * callsite via the helper `makePressable` below if a stricter API is
   * needed later — for now we just throw at runtime in dev.
   */
  accessibilityLabel?: string;
  /** Optional secondary description (announced after the label). */
  accessibilityHint?: string;
  style?: ViewStyle;
  children: React.ReactNode;
}

const variantBg: Record<Variant, string> = {
  default: colors.paper2,
  soft: colors.lavender50,
  peach: colors.peach50,
  mint: colors.mint50,
  yellow: colors.yellow50,
  rose: colors.rose50,
};

export function Card({
  variant = 'default',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  children,
}: Props) {
  const bg = variantBg[variant];
  const base: ViewStyle = {
    backgroundColor: bg,
    borderRadius: radius.lg,
    padding: space.s5,
    marginHorizontal: space.s6,
    marginBottom: space.s4,
    borderWidth: variant === 'default' ? 1 : 0,
    borderColor: colors.line,
  };
  if (onPress) {
    // Guard: dev-mode warning if the caller forgot to label an actionable card.
    // (VoiceOver/TalkBack otherwise read only the inner text — for our cards
    // that's the eyebrow + title which doesn't always describe the action.)
    if (!accessibilityLabel && __DEV__) {
      console.warn(
        '[Card] onPress is set but accessibilityLabel is missing. ' +
          'VoiceOver users will hear the card text but no action description. ' +
          'Pass accessibilityLabel="<verb the action>" to fix.',
      );
    }
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [base, pressed && { opacity: 0.7 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[base, style]} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: 'Menlo',
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  sub: {
    fontSize: 13,
    color: colors.textSoft,
    lineHeight: 18,
  },
});
