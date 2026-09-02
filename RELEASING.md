# Releasing Fernly v0.10.0+

The v0.10 release workflow ships via `.github/workflows/release.yml`.
This document explains what the workflow does and how to operate
the Cam-side checklist for the first release.

## TL;DR for a new release

```sh
# 1. Bump the version in a commit on main. Either:
#    a) merge the auto-generated bump PR from the previous release, or
#    b) manually edit app.json + package.json in a normal PR.
git checkout main
git pull
# 2. Tag the release. The tag is the source of truth for the version.
git tag v0.10.0
git push origin v0.10.0
# 3. Watch the workflow. The first job is the quality gate, then
#    per-platform build + submit (manual approval required), then
#    the auto-bump PR.
open "https://github.com/camster91/fernly/actions/workflows/release.yml"
# 4. After the iOS submit job runs, open TestFlight and add the
#    build to your internal beta group. After the Android submit
#    job runs, open Play Console and confirm the internal-track
#    release.
```

That's the happy path. Below is the full checklist for the
first-ever release (which requires some one-time setup the
happy path assumes).

## Prerequisites (do ONCE before the first release)

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
   - `APPLE_TEAM_ID` — your Apple developer team ID

### 2. Google Play Console service account

1. https://play.google.com/console → Setup → API access
2. Create a service account (or use existing).
3. Grant the service account "Release manager" permissions.
4. Download the JSON key. **Store it OUTSIDE the repo** at
   `.secrets/google-play.json` (gitignored per `.gitignore`).
   The EAS CLI reads this file at submit time.
5. The release workflow uses `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
   as a repo secret — paste the entire JSON contents there.
   (EAS will prefer the file on disk if present; the secret is
   the alternative for CI environments that don't have the file.)

### 3. Expo / EAS tokens

1. Install EAS CLI: `npm install -g eas-cli`
2. `eas login` — sign in with the Expo account that owns the
   `fernly-app` project.
3. https://expo.dev/accounts/[your-account]/settings/access-tokens →
   Create Token.
4. Copy the token.
5. In GitHub: New repository secret → `EXPO_TOKEN` — paste.

### 4. Protected environment for manual approval

The release workflow uses a GitHub protected environment named
`production`. To configure it:

1. Repo → Settings → Environments → New environment → name:
   `production`.
2. Under "Deployment protection rules", enable
   "Required reviewers" and add yourself (or a team).
3. The submit-ios and submit-android jobs require this
   environment, so a tag push that succeeds the quality gate
   will **wait for your manual approval** before submitting to
   TestFlight / Play Internal. The build already exists at that
   point — only the submit step needs approval.

### 5. EAS project + bundle identifier

`eas.json` declares `com.fernly.app` as the bundle identifier
and `production` + `preview` profiles. If you own a different
prefix, change `ascAppIdentifier` and the matching
`ios.bundleIdentifier` / `android.package` in `app.json`
**before the first release**. After a release is live in either
store, changing the identifier is a migration.

## What the release workflow does

`.github/workflows/release.yml` runs in seven sequential jobs:

1. **resolve-version** — derives the version from the tag (or
   the workflow_dispatch input), then verifies the tag matches
   `app.json.expo.version` and `package.json.version`. A mismatch
   fails the workflow before any build minute is burned.
2. **quality** — `npm ci --legacy-peer-deps`, `tsc --noEmit`,
   `eslint`, `vitest`. The same gates that run on PRs.
3. **build-ios** — `eas build --platform ios --profile preview`.
   Captures the build ID, writes it to
   `.release-evidence/v0.X.Y.yaml`. The `preview` profile uses
   `distribution: internal` so the build is installable on
   TestFlight but not submitted for review.
4. **submit-ios** — `eas submit --platform ios --id $BUILD_ID`.
   Binds to the exact build ID (not `--latest`) so a
   back-to-back release cannot submit a stale build. Requires
   the `production` environment (manual approval).
5. **build-android** — `eas build --platform android --profile preview`.
   Same shape as build-ios.
6. **submit-android** — `eas submit --platform android
   --id $BUILD_ID --track internal`. Requires the `production`
   environment.
7. **bump-version-pr** — opens a PR that bumps
   `app.json.expo.version` + `package.json.version` to the next
   patch (v0.x → next minor; v1+ → next patch). The PR is
   reviewed and merged normally — **the workflow never pushes
   directly to main** (the v0.9 release.yml did, which the
   issue-based delivery workflow (#65) explicitly forbids).

The release evidence file at
`.release-evidence/v0.X.Y.yaml` is gitignored so it doesn't
churn main. For rollback, check the workflow run's
"Record release evidence" step log to find the build IDs.

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

# 6. Set up EAS build signing (per platform)
eas build:configure
# Follow the prompts to upload iOS distribution cert +
# provisioning profile, and to set up Android keystore.
```

If all six pass, you're ready to ship.

## Rolling back a release

TestFlight / Play Console reject downgrades of the same
version. To roll back:

1. **Find the prior build**: open the `.release-evidence/`
   record for the version you want to roll back from, get the
   build ID, and check the workflow summary for the SHA.
2. **iOS**: Open TestFlight → find the build → "Remove from
   TestFlight" (or set expiry to past). The build ID for the
   previous version is in the v0.X.(Y-1).yaml evidence file.
3. **Android**: Play Console → Release management → Internal
   test track → Deactivate the bad release.

Then fix the issue on `main`, tag a new patch
(`v0.9.1`), and push. The bump-version PR auto-bumps to
`v0.9.2` once that's merged.

## What this doc deliberately doesn't do

- **No automatic version bumping on every commit.** Tags are
  manual — you decide when to ship.
- **No auto-release on PR merge.** PR-merged-to-main != "ready
  to ship". TestFlight reviews take hours; only push a tag when
  you're ready to ship.
- **No hard-coded bundle identifier.** `com.fernly.app` lives
  in `app.json` and `eas.json`. Change it before the FIRST
  release if you own a different bundle prefix.
- **No direct push to main from a release workflow.** The
  v0.9 workflow did this. v0.10+ opens a PR instead.
