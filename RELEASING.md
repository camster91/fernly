# Releasing Fernly v0.9.0

Cam-side checklist for shipping the first v0 release to
TestFlight + Google Play Internal. Once this is run once,
each subsequent release is just `git tag v0.X.0 && git push`.

## Prerequisites (do ONCE)

### 1. Apple App Store Connect API key + app ID

1. https://appstoreconnect.apple.com → Users and Access → Integrations →
   App Store Connect API → Generate a key with "App Manager" access.
2. Download the `.p8` file. **Save it now — you can't re-download.**
3. Store it on EAS (one time, from your machine):
   ```sh
   eas credentials --platform ios
   # → production → App Store Connect: Manage your API Key → Add a new key
   ```
   CI then uses this key automatically; no Apple secrets go in GitHub.
4. Find the app's **Apple ID** (a number) in App Store Connect → your app →
   App Information, and put it in `eas.json` →
   `submit.production.ios.ascAppId`. The release workflow refuses to run
   while it still says `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`.

### 2. Google Play Console service account

1. https://play.google.com/console → Setup → API access
2. Create a service account (or use existing).
3. Grant the service account "Release manager" permissions.
4. Download the JSON key.
5. In GitHub: New repository secret → `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
   — paste the entire JSON contents.

### 3. Expo / EAS tokens

1. Install EAS CLI: `npm install -g eas-cli`
2. `eas login` — sign in with the Expo account that owns the
   `fernly-app` project.
3. https://expo.dev/accounts/[your-account]/settings/access-tokens →
   Create Token.
4. Copy the token.
5. In GitHub: New repository secret → `EXPO_TOKEN` — paste.

### 4. eas.json

`eas.json` is committed. It uses `appVersionSource: "remote"` with
`autoIncrement: true`, so EAS keeps the build-number counter and
TestFlight / Play never see a duplicate — even though CI runners are
thrown away after each run.

## Releasing v0.9.0

```sh
cd ~/repos/fernly

# 1. Verify main is green
git status
npx tsc --noEmit
npx eslint .
npx vitest run
npx expo export --platform web --output-dir dist

# 2. Push everything that hasn't been pushed yet
git push origin main

# 3. Tag v0.9.0 — this triggers .github/workflows/release.yml
git tag v0.9.0
git push origin v0.9.0

# 4. Watch the workflow
open "https://github.com/camster91/fernly/actions/workflows/release.yml"

# 5. Once iOS submission completes, App Store Connect email
#    gets a build-notification. Open TestFlight and add the
#    build to your internal beta group.
```

## What the workflow does

`.github/workflows/release.yml` is the canonical pipeline.
When you push a `v*.*.*` tag (or run it manually), it:

1. **Quality gate** — `npm run ci` (typecheck, lint, format, tests). The
   build job only starts if this passes.
2. **Build iOS** — `eas build --platform ios --profile production`. Waits
   for the build to finish.
3. **Submit iOS to TestFlight** — `eas submit --platform ios --id <this build>` (by build ID, so an overlapping run can't swap builds).
4. **Build Android** — same, for Android.
5. **Submit Android to Play Internal** — writes the
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret to a temp file for
   `eas submit`, then deletes it.

## After the first release

The workflow does **not** bump the version. Before tagging the next
release, bump `version` in `app.json` and `package.json` on `main`, then:

```sh
git tag v0.X.0
git push origin v0.X.0
```

## Rolling back a release

TestFlight / Play Console reject downgrades of the same
version. To roll back:

1. **iOS**: Open TestFlight → find the build → "Remove from
   TestFlight" (or set expiry to past).
2. **Android**: Play Console → Release management → Internal
   test track → Deactivate the bad release.

Then fix the issue on `main`, retag with a patch bump
(`v0.9.1`), and push.

## Troubleshooting

- **"eas: command not found"** — install EAS CLI globally:
  `npm install -g eas-cli`.
- **"App Store Connect API Keys cannot be set up in --non-interactive
  mode"** — step 1.3 above wasn't done. Run `eas credentials --platform ios`
  locally and add the key.
- **Apple rejects the build for missing Info.plist keys** —
  re-run `npx expo prebuild --no-install --clean --platform ios`
  locally, fix `app.json`, commit, retag.
- **Android build fails on first run** — Play Console requires
  you to manually accept the data-safety form. Open the
  console, complete the form, retry.

## What this doc deliberately doesn't do

- **No automatic version bumping.** Tags and version bumps are
  manual — you decide when to ship.
- **No auto-release on PR merge.** PR-merged-to-main != "ready
  to ship". TestFlight reviews take hours; only push a tag when
  you're ready to ship.
- **No hard-coded bundle identifier.** `com.fernly.app` lives in
  `app.json`. Change it before the FIRST release if you own a
  different bundle prefix.

## First-time-on-a-new-machine checklist

If you're setting up a fresh Mac:

```sh
# 1. Install Node 20
brew install node@20 && echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc

# 2. Install Expo CLI + EAS CLI
npm install -g expo eas-cli

# 3. Clone the repo
git clone git@github.com:camster91/fernly.git ~/Code/fernly
cd ~/Code/fernly

# 4. Install deps
npm install

# 5. Run the gates once to confirm local env works
npx tsc --noEmit
npx eslint .
npx vitest run
npx expo export --platform web
```

If all four pass, you're ready to ship.
