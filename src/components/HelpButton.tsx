// "Need help now?" — a calm, always-available entry point to crisis helplines.
// Owns its own visibility state and renders the CrisisModal.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, space, type as t } from '../theme';
import { CrisisModal } from './CrisisModal';

export function HelpButton() {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Need help now?"
        accessibilityHint="Opens crisis helplines"
        onPress={() => setVisible(true)}
        hitSlop={space.s1}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Text style={styles.label}>Need help now?</Text>
      </Pressable>
      <CrisisModal visible={visible} onDismiss={() => setVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.s4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.rose50,
    borderWidth: 1.5,
    borderColor: colors.warnDeep,
  },
  pressed: { opacity: 0.7 },
  label: { ...t.smallBold, color: colors.warnDeep },
});
