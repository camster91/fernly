# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Cursor Cloud specific instructions

Fernly is a single Expo app (SDK 57 / React Native 0.86 / React 19). The only
runnable surface in the cloud VM is the **web** target — there are no iOS/Android
simulators here, so `npm run ios` / `npm run android` will not work.

- Run the app: `npx expo start --web --port 8084` (serves at `http://localhost:8084`). This is a long-running dev server; start it in a background/tmux session, not a blocking foreground call.
- Quality gates (same as CI, see `.github/workflows/ci.yml`): `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`. `npm run ci` runs all of them in sequence.
- Web bundle export gate: `npx expo export --platform web` (CI enforces a bundle-size budget on the output).
- The dev server prints "3 packages may need updating" from `expo install --check`; this is expected and non-blocking (CI treats it as best-effort).
- Deps are managed with npm (`package-lock.json`); use `npm ci`, not yarn/pnpm.
