// Button primitive — shared CTA across screens.
//
// v0.10 (issue #75): standardized the three button treatments
// that were previously inlined per screen:
//   - primary: full-width dark filled CTA (Save, Send, Begin, Try again)
//   - secondary: outlined lavender pill (close, cancel, exit, "open" affordance)
//   - tertiary: text-only lavender link (the "tone change requires reset" note,
//     helper text that links to another screen, etc.)
//
// All variants:
//   - minHeight 44pt (WCAG 2.5.5 tap target)
//   - 700-weight text
//   - explicit pressed state (opacity 0.7 / 0.85)
//   - optional accessibilityLabel / accessibilityHint
//   - optional loading state (busy=true + label swap)
//   - optional disabled state
//
// Variant props are mutually exclusive. Use a single Button per CTA;
// combining two Pressables in the same view is a code smell that this
// primitive replaces.
import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius, space, type as t } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

interface Props {
  /** Visual treatment. Default 'primary'. */
  variant?: ButtonVariant;
  /** Press handler. Omit for a non-interactive label-like button. */
  onPress?: () => void;
  /** Visible label. Required. */
  label: string;
  /** Spoken label for screen readers. Defaults to `label`. */
  accessibilityLabel?: string;
  /** Optional secondary description (announced after the label). */
  accessibilityHint?: string;
  /** Disables the button + reports disabled to assistive tech. */
  disabled?: boolean;
  /** True while an async action is in flight. Renders accessibilityState.busy. */
  loading?: boolean;
  /** Stretch the button to fill its parent's cross axis. Default true. */
  fullWidth?: boolean;
  /** Override the outer style. Use sparingly — most layout belongs in the parent. */
  style?: ViewStyle;
  /** Optional testID for component tests. */
  testID?: string;
}

const primaryTextColor = colors.paper;
const disabledTextColor = colors.paper;
const disabledBg = colors.ink4;

export function Button({
  variant = 'primary',
  onPress,
  label,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  loading = false,
  fullWidth = true,
  style,
  testID,
}: Props) {
  const interactive = !!onPress && !disabled && !loading;
  const containerStyle = [
    styles.base,
    styles[variant],
    fullWidth && styles.fullWidth,
    !interactive && styles.disabled,
    style,
  ];
  const textStyle = [
    styles.text,
    styles[`${variant}Text` as const],
    !interactive && styles.disabledText,
  ];

  if (!onPress) {
    return (
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: true }}
        style={containerStyle}
        testID={testID}
      >
        <Text style={textStyle}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => [containerStyle, pressed && interactive && styles.pressed]}
      testID={testID}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },

  primary: {
    backgroundColor: colors.ink,
  },
  secondary: {
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.lavender300,
  },
  tertiary: {
    backgroundColor: 'transparent',
  },
  destructive: {
    backgroundColor: colors.warnDeep,
  },

  text: {
    ...t.bodyBold,
    fontSize: 16,
  },
  primaryText: { color: primaryTextColor },
  secondaryText: { color: colors.lavender700, fontSize: 14 },
  tertiaryText: { color: colors.lavender700, fontSize: 14 },
  destructiveText: { color: primaryTextColor },
  disabledText: { color: disabledTextColor },

  // Spacing helpers — marginBottom 4 is a sensible default so a row of
  // Buttons stacks with consistent rhythm. Override via `style` if
  // the parent needs exact control.
  // (Margins belong to layout — keep this primitive margin-free and
  // let the screen wrap or stack via gap on the parent.)
});

// v0.10 (issue #76): spacing tokens for button rows. `Button` itself
// is margin-free so it composes cleanly inside a parent with `gap`.
export const buttonSpacing = { rowGap: space.s3 };
