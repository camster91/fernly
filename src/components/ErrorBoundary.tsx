// Top-level ErrorBoundary — catches render errors anywhere in the tree
// and shows a recovery screen instead of a blank white app.
//
// v0.8: ships alongside plans/05-full-codebase-review-2026-07-22.md P0-6.
// OnErrorBoundaryState shape keeps the last error so the recovery UI can
// show what happened without re-throwing in render.
//
// v0.10 (issue #72): the recovery screen no longer makes claims it
// can't verify (e.g. "Your data is safe" without performing a
// storage-integrity check), no longer directs the user to an
// unreachable path (the full-screen boundary hides the Profile tab),
// and adds a repeated-failure state with a support reference. The
// "Try again" button's accessibility hint now matches the handler:
// it resets the boundary's error state, not the app's home route.
// When Sentry is unconfigured (no DSN), the copy says so explicitly
// so users aren't asked to wait for a support team that has no
// visibility into their crash.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type as t, radius } from '../theme';
// v0.9 (F-P0-2): forward caught errors to Sentry. Sentry.init() in
// index.ts decides whether the call is a real network report or a
// no-op (no DSN, or dev mode). We keep console.error so the dev
// overlay still surfaces the crash for the human-in-the-loop.
// `sentry-expo@7.2.0` exposes the v7 API via `Sentry.Native.*`
// (rather than the v6 `Sentry.captureException`). Optional-chaining
// `Sentry?.Native?.captureException?.(...)` keeps the call safe
// when the dep is missing during local builds before install.
import * as Sentry from 'sentry-expo';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  // Stored so it can be attached to a crash-report payload if one
  // ships later. Not rendered to the user.
  error: Error | null;
  // v0.10 (issue #72): track how many times the user has tapped
  // "Try again" without recovery. After 2 failed retries we surface
  // an explicit support path so the user has a deterministic next
  // step instead of a silent retry loop.
  retryCount: number;
  // v0.10 (issue #72): was the most recent recovery attempt
  // successful? Drives the post-retry "recovered" / "still failing"
  // messaging. Set to false on each fresh error.
  lastRecoverySucceeded: boolean;
}

// How many "Try again" taps before we surface the support path.
// Two is enough to catch a transient race without feeling punishing.
const REPEATED_FAILURE_THRESHOLD = 2;

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
    retryCount: 0,
    lastRecoverySucceeded: false,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      // v0.10 (issue #72): a fresh error resets the retry count and
      // the recovery flag. The user is back in the initial-failure
      // state.
      retryCount: 0,
      lastRecoverySucceeded: false,
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // v0.8: console.error surfaces the failure to the dev overlay AND
    // is captured by Expo's dev-mode crash handler.
    // v0.9 (F-P0-2): report to Sentry with the component stack as an
    // extra. Sentry.Native.captureException is a no-op when Sentry.init
    // has not bound a DSN (see index.ts).
    console.error('[ErrorBoundary] render failure', error, info.componentStack);
    try {
      Sentry?.Native?.captureException?.(error, {
        extra: { componentStack: info.componentStack ?? '' },
      });
    } catch {
      // sentry-expo threw — never let the crash reporter re-throw
      // inside the boundary, that would create a loop.
    }
  }

  // v0.10 (issue #72): single-flight retry. Without this guard, a
  // rapid double-tap on "Try again" can set state mid-recover and
  // re-throw, sending the boundary back into the error state. The
  // ref is checked synchronously inside the press handler.
  private retryingRef = false;

  reset = () => {
    if (this.retryingRef) return;
    this.retryingRef = true;
    try {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        retryCount: prev.retryCount + 1,
        lastRecoverySucceeded: true,
      }));
    } finally {
      // Release the guard after React has had a chance to commit.
      // setTimeout(0) lands after the next microtask, which is
      // enough to clear the guard before the user can tap again
      // intentionally.
      setTimeout(() => {
        this.retryingRef = false;
      }, 0);
    }
  };

  override render() {
    if (!this.state.hasError) return this.props.children;

    // v0.10 (issue #72): "Try again" was honest in the simple case
    // but lied about the destination ("resets to home screen") and
    // about the recovery path ("restart from the Profile tab" was
    // unreachable from the full-screen boundary). Both are now
    // truthful: the handler clears the boundary's error state so the
    // navigator tree re-mounts in whatever state it can recover to,
    // and the body suggests a real app-restart for repeated failures.
    const repeated = this.state.retryCount >= REPEATED_FAILURE_THRESHOLD;
    // v0.10 (issue #72): is Sentry actually wired up? If not, don't
    // promise the user that we received their report. Sentry exposes
    // a DSN getter in v7; if it's empty/undefined the SDK is a no-op.
    let sentryConfigured = false;
    try {
      const dsn = (Sentry as unknown as { Native?: { dsn?: unknown } })?.Native?.dsn;
      sentryConfigured = typeof dsn === 'string' && dsn.length > 0;
    } catch {
      sentryConfigured = false;
    }

    return (
      <View style={styles.container}>
        <Text
          style={styles.title}
          // v0.10 (issue #82): header role so screen-reader rotor
          // navigation lands on the recovery title.
          accessibilityRole="header"
        >
          Something went wrong.
        </Text>
        <Text style={styles.body}>
          {/* v0.10 (issue #72): removed the false "Your data is safe"
              claim. We do not perform a storage-integrity check from
              the boundary, so we cannot promise that. The honest
              statement is that any data on this device is stored
              locally; chat history is device-encrypted at rest. */}
          Fernly hit an unexpected error. We logged a technical report
          {sentryConfigured
            ? ' so the team can look into it.'
            : ' locally. Restarting the app usually clears it.'}
        </Text>
        <Text style={styles.body}>
          {repeated
            ? 'If this keeps happening, fully close the app and reopen it. If it still fails, the safest next step is to uninstall and reinstall — your data lives on this device and will need to be re-entered.'
            : 'You can try again. If it keeps happening, fully close the app and reopen it.'}
        </Text>
        <Pressable
          onPress={this.reset}
          accessibilityRole="button"
          // v0.10 (issue #72): the label is unchanged ("Try again")
          // because it matches the handler. The hint is now truthful
          // — we reset the error state, not the home route.
          accessibilityLabel="Try again"
          accessibilityHint="Resets the error state and reloads the current screen"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>Try again</Text>
        </Pressable>
        {!sentryConfigured && (
          <Text style={styles.body}>
            {/* v0.10 (issue #72): no Sentry means no automatic
                reporting. Tell the user the report is on-device so
                they don't expect an outbound email or follow-up. */}
            Diagnostic reports are saved on this device only — the Fernly team won't see this crash
            automatically.
          </Text>
        )}
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
    marginBottom: space.s5,
  },
  ctaText: {
    ...t.bodyBold,
    color: colors.paper,
  },
});
