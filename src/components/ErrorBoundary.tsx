// Top-level ErrorBoundary — catches render errors anywhere in the tree
// and shows a recovery screen instead of a blank white app.
//
// v0.8: ships alongside plans/05-full-codebase-review-2026-07-22.md P0-6.
// OnErrorBoundaryState shape keeps the last error so the recovery UI can
// show what happened without re-throwing in render.
//
// Recovery: "Try again" resets the boundary state, which re-mounts the
// children (the navigator tree). For a wellness app, getting the user
// back to the home screen in one tap is the priority; deep error data
// is logged for crash-reporting but not shown in the recovery UI.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type as t, radius } from '../theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  // Stored so it can be attached to a crash-report payload if one
  // ships later. Not rendered to the user.
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // v0.8: console.error surfaces the failure to the dev overlay AND
    // is captured by Expo's dev-mode crash handler. When Sentry ships
    // (DevOps C3), replace this with Sentry.captureException.
    console.error('[ErrorBoundary] render failure', error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong.</Text>
        <Text style={styles.body}>
          We hit an unexpected error. Your data is safe — try again, and if it keeps happening,
          restart the app from the Profile tab.
        </Text>
        <Pressable
          onPress={this.reset}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          accessibilityHint="Resets the app to the home screen"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    backgroundColor: colors.bg,
  },
  title: {
    ...t.displayLg,
    color: colors.text,
    marginBottom: space.s3,
    textAlign: 'center',
  },
  body: {
    ...t.body,
    color: colors.textSoft,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: space.s5,
  },
  cta: {
    backgroundColor: colors.ink,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: radius.full,
  },
  ctaText: {
    ...t.bodyBold,
    color: colors.paper,
  },
});
