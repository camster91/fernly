// Card primitive — the workhorse component.
// Variants: default (paper-on-paper), soft (pastel), with optional press handler.
import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

type Variant = 'default' | 'soft' | 'peach' | 'mint' | 'yellow' | 'rose';

interface Props {
  variant?: Variant;
  onPress?: () => void;
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

export function Card({ variant = 'default', onPress, style, children }: Props) {
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
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, pressed && { opacity: 0.7 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
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
