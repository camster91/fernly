// Pill primitive — selectable pill / chip used in onboarding mood + goal
// pickers, MoodCheckInScreen quick-word picker, SettingsScreen
// mascot/tone choices.
//
// v0.10 (issue #75): standardized the three inlined pill treatments
// (OnboardingScreen pill, MoodCheckInScreen wordPill,
// SettingsScreen toneRow) into a single primitive that:
//   - applies the accentSelected / paper pair for selected state
//     (8.6:1 contrast, 2px border, 700 weight — all required for
//     #81 compliance and color-blind cue)
//   - sizes: small (12pt text, e.g. quick words), medium (14pt,
//     onboarding mood/goal), large (16pt, Settings tone rows)
//   - optional icon slot for a non-color selected indicator
//   - explicit accessibilityRole="button" + accessibilityState.selected
//   - 44pt min tap target (WCAG 2.5.5)
//
// Variants:
//   - 'solid' (default): paper bg when unselected, accentSelected
//     when selected
//   - 'tinted': lavender50 when unselected, accentSelected when
//     selected. Used for Settings mascot cards.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, space, type as t } from '../theme';

export type PillSize = 'small' | 'medium' | 'large';
export type PillVariant = 'solid' | 'tinted';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
  size?: PillSize;
  variant?: PillVariant;
  /** Optional non-color selected indicator (e.g. a ✓ glyph). */
  selectedIcon?: string;
  /** Optional trailing caption, e.g. "Call 988" on the helpline pill. */
  caption?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
}

export function Pill({
  label,
  selected,
  onPress,
  size = 'medium',
  variant = 'solid',
  selectedIcon,
  caption,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: Props) {
  const textStyle = [
    styles.text,
    styles[`${size}Text` as const],
    selected && styles.textSelected,
  ];
  const containerStyle = [
    styles.base,
    styles[`${size}Base` as const],
    styles[`${variant}Base` as const],
    selected && styles.selectedBase,
    selected && styles.selectedBorder,
    style,
  ];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={({ pressed }) => [containerStyle, pressed && styles.pressed]}
      testID={testID}
    >
      {selectedIcon && (
        <Text
          style={[styles.icon, selected ? styles.iconSelected : styles.iconDefault]}
        >
          {selectedIcon}
        </Text>
      )}
      <View style={styles.contentCol}>
        <Text style={textStyle}>{label}</Text>
        {caption && <Text style={[styles.caption, selected && styles.captionSelected]}>{caption}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.7 },

  // Size scales. minHeight 44pt (WCAG 2.5.5) enforced across all sizes
  // so a tap target never shrinks below the recommendation.
  smallBase: { paddingHorizontal: 12, paddingVertical: 6, minHeight: 44 },
  mediumBase: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44 },
  largeBase: { paddingHorizontal: 18, paddingVertical: 12, minHeight: 44 },

  // Variant: solid uses paper bg when unselected, lavender tint
  // when selected. tinted uses lavender50 when unselected (slightly
  // tinted "rest" state) — used for SettingsScreen mascot cards.
  solidBase: { backgroundColor: colors.paper2 },
  tintedBase: { backgroundColor: colors.lavender50, borderColor: colors.lavender100 },

  // Selected state — 2px border on accentSelected for the color-blind
  // cue (#81). Border width bumps from 1 to 2; padding shrinks 1px
  // on the horizontal axis so the visual size stays constant.
  selectedBase: {
    backgroundColor: colors.accentSelected,
    borderColor: colors.accentSelected,
  },
  selectedBorder: {
    borderWidth: 2,
    paddingHorizontal: 15, // small/medium/large all subtract 1 on the horizontal axis
  },

  contentCol: { alignItems: 'center', justifyContent: 'center' },
  text: {
    fontWeight: '600',
    color: colors.text,
  },
  smallText: { fontSize: 13 },
  mediumText: { fontSize: 14 },
  largeText: { fontSize: 16 },
  textSelected: { color: colors.accentSelectedText, fontWeight: '700' },

  icon: { fontSize: 14, marginRight: 6 },
  iconDefault: { color: colors.text },
  iconSelected: { color: colors.accentSelectedText },

  caption: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  captionSelected: { color: colors.accentSelectedText },
});
