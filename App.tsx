// Root component — mounts the StatusBar, kicks off the crisis-resource
// reachability check (best-effort, never blocks UI), then renders the
// navigator. See src/nav/RootNav.tsx for the navigation hierarchy.
//
// On web, the app is constrained to a phone-shaped viewport (414px wide,
// centered with a neutral background) so the iOS-first layout doesn't
// stretch across a laptop screen. The wrapper is a no-op on iOS/Android
// because they render full-screen by default — the constraint only
// matters on the web target.
//
// v0.8: wrapped in ErrorBoundary so a render error anywhere in the
// navigator tree shows a recovery screen instead of a blank app.
// See plans/05-full-codebase-review-2026-07-22.md P0-6.
import React, { useEffect } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { RootNav } from './src/nav/RootNav';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { verifyResourceReachability } from './src/safety/crisis';
import { colors } from './src/theme';

// All URLs we currently surface as crisis resources. Pre-flight HEAD-checks
// at app start so the CrisisModal banner can warn if any are stale.
const CRISIS_RESOURCE_URLS: string[] = [
  'https://findahelpline.com',
  'https://iasp.info/resources/Crisis_Centres/',
];

// Phone-shaped frame for the web build. 414px matches the widest iPhone
// (Plus/Max/Pro Max) at 3x scale; any larger and the cards stop being
// pleasant to read because lines get too long. The soft-purple border
// (colors.lavender100) gives the phone a visual frame against the
// neutral desktop background.
const WEB_PHONE_WIDTH = 414;

export default function App() {
  useEffect(() => {
    // Best-effort — silently no-ops on failure. The cache in crisis.ts is
    // only populated for URLs that respond OK within the timeout.
    verifyResourceReachability(CRISIS_RESOURCE_URLS).catch(() => undefined);
  }, []);

  const content = (
    <>
      <StatusBar style="auto" />
      <RootNav />
    </>
  );

  // iOS/Android: render full-screen, no wrapper.
  if (Platform.OS !== 'web') {
    return <ErrorBoundary>{content}</ErrorBoundary>;
  }

  // Web: phone-shaped frame, centered on a soft-purple desktop background.
  // The Dimensions call gets the actual viewport height so the frame
  // fills the browser window instead of being a fixed pixel value.
  const win = Dimensions.get('window');

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.lavender50,
        minHeight: win.height,
      }}
    >
      <View
        style={{
          width: WEB_PHONE_WIDTH,
          maxWidth: win.width,
          height: win.height,
          maxHeight: 896, // iPhone 11 Pro Max height — keeps a phone aspect ratio
          backgroundColor: colors.paper,
          borderWidth: 1,
          borderColor: colors.lavender100,
          // Soft shadow gives the phone frame a sense of lift against the
          // desktop background. RN Web renders boxShadow as CSS box-shadow.
          boxShadow: '0 8px 32px rgba(42, 36, 56, 0.08)',
          overflow: 'hidden',
        }}
      >
        <ErrorBoundary>{content}</ErrorBoundary>
      </View>
    </View>
  );
}
