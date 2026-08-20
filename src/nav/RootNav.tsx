// Root navigation
// Two layers:
//   1. Onboarding gate — shows Onboarding until profile.onboarded = true
//   2. Bottom tab navigator — Today / Chat / Practice / Insights / You
// Plus a native stack inside for modal flows (MoodCheckIn, Exercise, Settings).
//
// v0.10 (issue #67): the non-initial screens are lazy-loaded via
// React.lazy + dynamic import. TodayScreen + OnboardingScreen stay
// as static imports because they're the cold-start paths — a first
// launch should not pay a Suspense round-trip before seeing the
// first frame. The other 7 screens are loaded on demand the first
// time the user navigates to them. ChatScreen is the largest of the
// lazy set (carries the ChatHistorySheet, FlatList + render
// machinery, react-native-svg-free, etc.) so its deferred load
// produces the largest bundle delta.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Eager imports — cold-start paths. Don't lazy these; the user
// would wait a Suspense round-trip before seeing the first frame.
import { TodayScreen } from '../screens/TodayScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
// v0.10 (issue #67): lazy imports for non-initial screens. Each
// is a separate JS chunk that Metro emits on first navigation.
// The `.then(m => ({ default: m.ScreenName }))` wrapper handles
// the named-export-vs-default-export interop that React.lazy
// requires.
const ChatScreen = lazy(() =>
  import('../screens/ChatScreen').then((m) => ({ default: m.ChatScreen })),
);
const PracticeScreen = lazy(() =>
  import('../screens/PracticeScreen').then((m) => ({ default: m.PracticeScreen })),
);
const ExerciseScreen = lazy(() =>
  import('../screens/ExerciseScreen').then((m) => ({ default: m.ExerciseScreen })),
);
const InsightsScreen = lazy(() =>
  import('../screens/InsightsScreen').then((m) => ({ default: m.InsightsScreen })),
);
const ProfileScreen = lazy(() =>
  import('../screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen })),
);
const SettingsScreen = lazy(() =>
  import('../screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);
const MoodCheckInScreen = lazy(() =>
  import('../screens/MoodCheckInScreen').then((m) => ({ default: m.MoodCheckInScreen })),
);
import { colors, type as t, radius, space } from '../theme';
import { storage, onStorageReset } from '../storage';

import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Today: undefined;
  Chat: undefined;
  Practice: undefined;
  Insights: undefined;
  You: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  MoodCheckIn: undefined;
  Exercise: { exerciseId: string };
  // Settings is reserved for a future in-app settings screen (privacy,
  // data controls, tone change). Today the ProfileScreen "Legal & safety"
  // row shows an Alert.alert placeholder; the route type is forward-
  // compatible so the screen can land without further type churn.
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// v0.10 (issue #67): small Suspense fallback shown while a
// lazy chunk is fetching. Sized to fill the screen so the
// navigator doesn't render an empty frame during the load.
// The accessibilityRole + label announce the load to screen
// readers so the user knows what's happening.
function ScreenFallback() {
  return (
    <View
      style={styles.screenFallback}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading screen. One moment."
    >
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.screenFallbackText}>Loading…</Text>
    </View>
  );
}

// v0.10 (issue #67): withSuspense wraps a lazy component in a
// Suspense boundary that renders ScreenFallback while the chunk
// is fetching. Passes through all props so the navigator's
// route params (e.g. Exercise.params.exerciseId) flow
// unchanged. The cast is necessary because React.lazy's
// `ComponentType` is unparameterized (P is `{}` by default)
// while the navigator expects specific props (navigation,
// route). The runtime behavior is identical — the navigator
// passes the right props at runtime; TS just needs help
// matching them statically.
function withSuspense<P extends object>(
  Component: React.LazyExoticComponent<React.ComponentType<any>>,
): React.ComponentType<P> {
  const Wrapped = (props: P) => (
    <Suspense fallback={<ScreenFallback />}>
      <Component {...(props as unknown as object)} />
    </Suspense>
  );
  Wrapped.displayName = `withSuspense(${
    (Component as { displayName?: string }).displayName ?? 'Lazy'
  })`;
  return Wrapped as React.ComponentType<P>;
}

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <View style={styles.tabIcon}>
      <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{glyph}</Text>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // v0.10 (issue #62): the previous tab bar had a hard
        // 80pt height + 10pt labels, which clipped at 200%
        // text scale (a 10pt label scaled 2x = 20pt needs more
        // than 16pt vertical room). Removed the fixed `height`
        // and bumped labels to 12pt; the bar's height is now
        // driven by its content + the safe-area padding.
        tabBarStyle: {
          backgroundColor: colors.paper2,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        // v0.10 (issue #62): labels are 12pt (was 10pt) so they
        // remain legible at the default scale and don't shrink
        // when scaled up.
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="✿" focused={focused} />,
          // v0.7: VoiceOver/TalkBack previously announced the emoji glyph
          // ("cherry blossom") instead of "Today, tab 1 of 5". Explicit
          // labels fix the disambiguation.
          tabBarAccessibilityLabel: 'Today, tab 1 of 5',
        }}
      />
      <Tab.Screen
        name="Chat"
        component={withSuspense(ChatScreen)}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="💬" focused={focused} />,
          tabBarAccessibilityLabel: 'Chat, tab 2 of 5',
        }}
      />
      <Tab.Screen
        name="Practice"
        component={withSuspense(PracticeScreen)}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="🧘" focused={focused} />,
          tabBarAccessibilityLabel: 'Practice, tab 3 of 5',
        }}
      />
      <Tab.Screen
        name="Insights"
        component={withSuspense(InsightsScreen)}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="📊" focused={focused} />,
          tabBarAccessibilityLabel: 'Insights, tab 4 of 5',
        }}
      />
      <Tab.Screen
        name="You"
        component={withSuspense(ProfileScreen)}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="👤" focused={focused} />,
          tabBarAccessibilityLabel: 'Profile, tab 5 of 5',
        }}
      />
    </Tab.Navigator>
  );
}

function LoadingScreen() {
  // v0.9: screen-reader friendly brand + spinner. Previously a
  // bare ActivityIndicator on a bg-colored View — VoiceOver/TalkBack
  // users heard "Loading..." with no context. Plans/05 P2-22.
  return (
    <View
      style={styles.loading}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your space. One moment while we read your profile."
    >
      <Text style={styles.loadingMark} accessibilityElementsHidden>
        🌱
      </Text>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.loadingText}>Loading your space</Text>
      <Text style={styles.loadingHint}>One moment while we read your profile.</Text>
    </View>
  );
}

// v0.10 (issue #79): explicit error state for a failed profile
// hydration. Renders inside SafeAreaProvider so it works on iOS
// notch devices and Android edge-to-edge. The CTA re-runs the
// hydration read; the error reason is shown so the user (or a
// future support flow) can act on it. Never auto-routes to
// onboarding from this state.
function HydrationErrorScreen({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <View style={styles.hydrationError}>
      <Text
        style={styles.hydrationErrorTitle}
        accessibilityRole="header"
      >
        Couldn't read your profile.
      </Text>
      <Text style={styles.hydrationErrorBody}>
        We hit a problem loading Fernly. Your data may still be on this device — we just can't open
        it right now. Try again, or close and reopen the app.
      </Text>
      <Text
        style={styles.hydrationErrorReason}
        accessibilityLabel={`Technical detail: ${reason}`}
      >
        {reason}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try loading your profile again"
        style={({ pressed }) => [
          styles.hydrationErrorCta,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.hydrationErrorCtaText}>Try again</Text>
      </Pressable>
    </View>
  );
}

// v0.10 (issue #79): hydration state for the profile read. The
// boundary between "first run" and "couldn't read your data" is
// critical — a returning user whose AsyncStorage failed must NOT
// be routed into onboarding (which would overwrite the existing
// profile on save). See getProfileSafe in storage.ts.
type Hydration =
  | { kind: 'loading' }
  | { kind: 'ready'; profile: import('../types').UserProfile | null }
  | { kind: 'error'; reason: string };

export function RootNav() {
  const [hydration, setHydration] = useState<Hydration>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // v0.10 (issue #79): use the result-returning read so a failure
      // is distinguishable from a legitimate first run. Previously a
      // try/catch on getProfile() set onboarded=false on ANY throw,
      // which is exactly the silent onboarding-routing bug the issue
      // describes.
      const result = await storage.getProfileSafe();
      if (cancelled) return;
      if (result.kind === 'error') {
        setHydration({ kind: 'error', reason: result.reason });
      } else if (result.kind === 'empty') {
        setHydration({ kind: 'ready', profile: null });
      } else {
        setHydration({ kind: 'ready', profile: result.profile });
      }
    })();
    // Subscribe to storage.reset events so that "Reset Fernly" in the
    // ProfileScreen actually returns the user to onboarding. Without this,
    // RootNav's onboarded state stays in memory and the user lands on
    // an empty tabs UI. The unsubscribe function cleans up on unmount.
    //
    // v0.10 (issue #79): reset re-reads via the safe API so a reset
    // followed by a storage failure doesn't get stuck on the wrong
    // screen. A reset that fails to read now shows the error screen
    // instead of falling into onboarding.
    const unsubscribe = onStorageReset(async () => {
      const result = await storage.getProfileSafe();
      if (cancelled) return;
      if (result.kind === 'error') {
        setHydration({ kind: 'error', reason: result.reason });
      } else if (result.kind === 'empty') {
        setHydration({ kind: 'ready', profile: null });
      } else {
        setHydration({ kind: 'ready', profile: result.profile });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // v0.10 (issue #79): show an explicit error screen when the read
  // failed. Never route a returning user into onboarding from an
  // exception. The screen has a retry that re-runs the same effect.
  if (hydration.kind === 'loading') return <LoadingScreen />;
  if (hydration.kind === 'error') {
    return (
      <SafeAreaProvider>
        <HydrationErrorScreen
          reason={hydration.reason}
          onRetry={() => setHydration({ kind: 'loading' })}
        />
      </SafeAreaProvider>
    );
  }
  const onboarded = !!hydration.profile?.onboarded;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {!onboarded ? (
          <OnboardingScreen
            onDone={async () => {
              // v0.10 (issue #79): onboarding completion now updates
              // the hydration state directly. Previously this called
              // setOnboarded(true) which still read from the now-removed
              // useState. Re-running the safe read is the safest
              // path: it surfaces any post-save storage error rather
              // than silently marking the user onboarded.
              //
              // v0.10 (issue #52): use the strict variant so a write
              // failure is surfaced via the hydration error path
              // instead of silently flipping the user into the main
              // tabs.
              await storage.setOnboardedStrict(true);
              const after = await storage.getProfileSafe();
              if (after.kind === 'ready') {
                setHydration({ kind: 'ready', profile: after.profile });
              } else if (after.kind === 'empty') {
                setHydration({ kind: 'ready', profile: null });
              } else {
                setHydration({ kind: 'error', reason: after.reason });
              }
            }}
          />
        ) : (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen
              name="MoodCheckIn"
              component={withSuspense(MoodCheckInScreen)}
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="Exercise" component={withSuspense(ExerciseScreen)} />
            {/* v0.9: real Settings screen — replaces the Alert.alert
                placeholders that ProfileScreen was triggering for
                "Export your data" / "Legal & safety" / etc. */}
            <Stack.Screen
              name="Settings"
              component={withSuspense(SettingsScreen)}
              options={{ presentation: 'modal' }}
            />
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  loadingMark: { fontSize: 48, marginBottom: 12 },
  loadingText: { ...t.body, color: colors.text, marginTop: 12 },
  loadingHint: { ...t.small, color: colors.textMuted, marginTop: 4 },
  // v0.10 (issue #67): screen-level Suspense fallback. The bg
  // matches the screen so the navigator doesn't flash during
  // the lazy chunk fetch.
  screenFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  screenFallbackText: { ...t.body, color: colors.textMuted, marginTop: 12 },
  // v0.10 (issue #79): hydration-error screen styles. Padded top so
  // the title doesn't sit flush against the iOS notch / Android
  // status bar on first launch. No logo, no streak, no greeting — this
  // is a recovery surface, not a brand surface.
  hydrationError: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    backgroundColor: colors.bg,
  },
  hydrationErrorTitle: {
    ...t.displayLg,
    color: colors.text,
    marginBottom: space.s3,
    textAlign: 'center',
  },
  hydrationErrorBody: {
    ...t.body,
    color: colors.textSoft,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: space.s4,
  },
  hydrationErrorReason: {
    ...t.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: space.s5,
    fontFamily: 'Menlo',
  },
  hydrationErrorCta: {
    backgroundColor: colors.ink,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: radius.full,
  },
  hydrationErrorCtaText: { ...t.bodyBold, color: colors.paper },
  tabIcon: { alignItems: 'center', justifyContent: 'center' },
  // v0.10 (issue #62): removed the legacy `tabBar` style that
  // locked the bar to a fixed 80pt height. The bar style now
  // lives inline in the screenOptions above so the height is
  // derived from content rather than a hardcoded pixel value.
});
