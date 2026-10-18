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
import { HelpButton } from './HelpButton';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  /** Show the top-right "Need help now?" button. Defaults to true. */
  showHelp?: boolean;
}

export function ScreenContainer({
  children,
  scroll = true,
  style,
  edges = ['top'],
  showHelp = true,
}: Props) {
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
      {showHelp ? (
        <View style={styles.helpRow}>
          <HelpButton />
        </View>
      ) : null}
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // In-flow row (not absolutely positioned) so it can never cover screen content.
  helpRow: { alignItems: 'flex-end', paddingHorizontal: space.s5, paddingTop: space.s2 },
  scroll: { flex: 1 },
  content: { paddingBottom: space.s9 + 60 /* tab bar */ },
  fixed: { flex: 1 },
});
