# Releasing Fernly v0.9.0

Cam-side checklist for shipping the first v0 release to
TestFlight + Google Play Internal. Once this is run once,
each subsequent release is just `git tag v0.X.0 && git push`.

## Prerequisites (do ONCE)

### 1. Apple App Store Connect API key

1. https://appstoreconnect.apple.com → Users / Keys / Generate
2. Download the `.p8` file. **Save it now — you can't re-download.**
3. Note the Issuer ID and Key ID.
4. Convert the `.p8` to base64:
   ```sh
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```
5. In GitHub: Settings → Secrets and variables → Actions →
   New repository secret. Add:
   - `ASC_API_KEY_BASE64` — the base64 string from step 4
   - `ASC_KEY_ID` — the Key ID from step 3
   - `ASC_ISSUER_ID` — the Issuer ID from step 3

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

### 4. eas.json profile (one-time local)

Ensure `eas.json` has a `production` profile that uses
`autoIncrement: true` so TestFlight doesn't reject duplicate
build numbers. The shipped repo already has this; verify with:

```sh
cat eas.json
```

Expected structure:

```json
{
  "build": {
    "production": {
      "autoIncrement": true
    }
  }
}
```

If absent, run `eas build:configure` to generate one.

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
When you push a `v*.*.*` tag, it:

1. **Build for iOS (TestFlight)** — `eas build --platform ios --non-interactive --no-wait`
2. **Submit iOS to TestFlight** — `eas submit --platform ios --latest --auto-submit`
3. **Build for Android (Internal track)** — `eas build --platform android --non-interactive --no-wait`
4. **Submit Android to Play Internal** — `eas submit --platform android --latest --track internal`
5. **Bump version on main** — increments `package.json` version, commits
   `[skip ci]` so the new version is on `main` for the next release.

Steps run sequentially because TestFlight + Play both depend on the
build finishing first.

## After the first release

Each subsequent release is just:

```sh
git tag v0.X.0
git push origin v0.X.0
```

The workflow reads the new tag, builds, submits, and bumps. No
manual `git push origin main` needed — the workflow does it.

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
- **"build not found"** — the workflow's build step hasn't
  completed yet; `eas submit --latest` finds nothing to submit.
  Re-run the workflow once the build finishes.
- **Apple rejects the build for missing Info.plist keys** —
  re-run `npx expo prebuild --no-install --clean --platform ios`
  locally, fix `app.json`, commit, retag.
- **Android build fails on first run** — Play Console requires
  you to manually accept the data-safety form. Open the
  console, complete the form, retry.

## What this doc deliberately doesn't do

- **No automatic version bumping on every commit.** Tags are
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
