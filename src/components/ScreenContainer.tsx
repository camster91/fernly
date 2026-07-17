// Screen container — sets background, handles safe areas, gives consistent padding.
//
// `edges` lets callers opt out of the top safe-area inset (e.g. when the
// screen has its own header that already accounts for it). Defaults to
// `['top']`. Use `[]` to skip safe-area handling entirely (rare; only when
// the screen renders edge-to-edge with no native chrome).
import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '../theme';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function ScreenContainer({ children, scroll = true, style, edges = ['top'] }: Props) {
  const content = scroll ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, style]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fixed, style]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: space.s9 + 60 /* tab bar */ },
  fixed: { flex: 1 },
});
