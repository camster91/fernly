// Root navigation
// Two layers:
//   1. Onboarding gate — shows Onboarding until profile.onboarded = true
//   2. Bottom tab navigator — Today / Practice / Insights / You
// Plus a native stack inside for modal flows (MoodCheckIn, Exercise, Settings).
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TodayScreen } from '../screens/TodayScreen';
import { PracticeScreen } from '../screens/PracticeScreen';
import { ExerciseScreen } from '../screens/ExerciseScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { MoodCheckInScreen } from '../screens/MoodCheckInScreen';
import { PlayerScreen } from '../screens/PlayerScreen';
import { colors, type as t } from '../theme';
import { storage, onStorageReset } from '../storage';

import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Today: undefined;
  Practice: undefined;
  Insights: undefined;
  You: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  MoodCheckIn: undefined;
  Exercise: { exerciseId: string };
  Player: { sessionId: string };
  // Settings is reserved for a future in-app settings screen (privacy,
  // data controls, tone change). Today the ProfileScreen "Legal & safety"
  // row shows an Alert.alert placeholder; the route type is forward-
  // compatible so the screen can land without further type churn.
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

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
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="✿" focused={focused} />,
          // v0.7: VoiceOver/TalkBack previously announced the emoji glyph
          // ("cherry blossom") instead of "Today, tab 1 of 4". Explicit
          // labels fix the disambiguation.
          tabBarAccessibilityLabel: 'Today, tab 1 of 4',
        }}
      />
      <Tab.Screen
        name="Practice"
        component={PracticeScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="🧘" focused={focused} />,
          tabBarAccessibilityLabel: 'Practice, tab 2 of 4',
        }}
      />
      <Tab.Screen
        name="Insights"
        component={InsightsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="📊" focused={focused} />,
          tabBarAccessibilityLabel: 'Insights, tab 3 of 4',
        }}
      />
      <Tab.Screen
        name="You"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="👤" focused={focused} />,
          tabBarAccessibilityLabel: 'Profile, tab 4 of 4',
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

export function RootNav() {
  const [loaded, setLoaded] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await storage.getProfile();
        if (!cancelled) setOnboarded(!!p?.onboarded);
      } catch {
        // Storage layer failed. Treat as a fresh install — show onboarding
        // so the user can recover rather than stare at a spinner forever.
        if (!cancelled) setOnboarded(false);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    // Subscribe to storage.reset events so that "Reset Fernly" in the
    // ProfileScreen actually returns the user to onboarding. Without this,
    // RootNav's onboarded state stays in memory and the user lands on
    // an empty tabs UI. The unsubscribe function cleans up on unmount.
    const unsubscribe = onStorageReset(() => {
      // Re-read profile — if it's gone (cleared), show onboarding.
      // Don't await: the listener should be sync-friendly, and a stale
      // onboarded=false is the safest default.
      storage
        .getProfile()
        .then((p) => setOnboarded(!!p?.onboarded))
        .catch(() => setOnboarded(false));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!loaded) return <LoadingScreen />;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {!onboarded ? (
          <OnboardingScreen
            onDone={async () => {
              await storage.setOnboarded(true);
              setOnboarded(true);
            }}
          />
        ) : (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen
              name="MoodCheckIn"
              component={MoodCheckInScreen}
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="Exercise" component={ExerciseScreen} />
            <Stack.Screen name="Player" component={PlayerScreen} />
            {/* v0.9: real Settings screen — replaces the Alert.alert
                placeholders that ProfileScreen was triggering for
                "Export your data" / "Legal & safety" / etc. */}
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
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
  tabBar: {
    backgroundColor: colors.paper2,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    paddingBottom: 24,
    height: 80,
  },
  tabIcon: { alignItems: 'center', justifyContent: 'center' },
});
