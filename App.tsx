// Root component — mounts the StatusBar, kicks off the crisis-resource
// reachability check (best-effort, never blocks UI), then renders the
// navigator. See src/nav/RootNav.tsx for the navigation hierarchy.
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { RootNav } from './src/nav/RootNav';
import { verifyResourceReachability } from './src/safety/crisis';

// All URLs we currently surface as crisis resources. Pre-flight HEAD-checks
// at app start so the CrisisModal banner can warn if any are stale.
const CRISIS_RESOURCE_URLS: string[] = [
  'https://findahelpline.com',
  'https://iasp.info/resources/Crisis_Centres/',
];

export default function App() {
  useEffect(() => {
    // Best-effort — silently no-ops on failure. The cache in crisis.ts is
    // only populated for URLs that respond OK within the timeout.
    verifyResourceReachability(CRISIS_RESOURCE_URLS).catch(() => undefined);
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <RootNav />
    </>
  );
}
