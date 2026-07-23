// Entry point — registered with Expo via registerRootComponent below.
// Also bootstraps Sentry crash reporting (F-P0-2).
//
// Sentry init is gated on a real DSN being provided. The shipped
// default is a placeholder; without a real DSN, Sentry.init is
// skipped and captureException calls in ErrorBoundary become no-ops.
// Cam must set EXPO_PUBLIC_SENTRY_DSN in their env (or via EAS
// secrets) before crash reports start flowing. See the PLAN block
// in src/components/ErrorBoundary.tsx for the full ops checklist.
import * as Sentry from 'sentry-expo';
import { registerRootComponent } from 'expo';

import App from './App';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Placeholder DSN we'd ship by accident if Cam forgets to set the env.
// It is intentionally a clearly-invalid value so we can detect it and
// refuse to init Sentry (which would otherwise spam Sentry's onboarding
// endpoint with an unverifiable event).
const PLACEHOLDER_DSN = 'https://placeholder@o0.ingest.sentry.io/0';

if (SENTRY_DSN && SENTRY_DSN !== PLACEHOLDER_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    enableInExpoDevelopment: !__DEV__,
    debug: false,
  });
} else {
  console.log(
    '[sentry] no EXPO_PUBLIC_SENTRY_DSN configured (or placeholder detected) — ' +
      'crash reporting is a no-op. Set the real DSN to enable.',
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
