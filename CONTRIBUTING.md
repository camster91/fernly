# Contributing to Fernly

Thanks for your interest in Fernly. We're a v0 alpha (built 2026-07-10) and the project is moving fast. Below is what you'll need to know to get a PR merged without friction.

## Ground rules

1. **Lead with safety, not velocity.** Any change to `src/safety/`, `src/components/CrisisModal.tsx`, the chat pipeline, or `storage.ts` deserves a careful review. We will ask questions.
2. **No silent behavior changes.** If your PR changes what users see, what we send to them, or what we log about them, the PR description needs a behavioral diff section.
3. **Tests for non-trivial code.** A 1-line bug fix may not need a test. A new function, a new code path, or any change to `src/safety/`, `crisis.ts`, or any `src/storage.ts` mutation surface needs test coverage.
4. **No secrets in the diff.** Pre-commit checks plus GitHub Secret Scanning are configured, but neither is perfect.

## Reporting an issue

- **Bugs and feature requests:** [GitHub Issues](https://github.com/camster91/fernly/issues).
- **Security vulnerabilities:** see [SECURITY.md](./SECURITY.md). **Don't post those to GitHub Issues.**
- **Crisis-detector false positives / negatives:** even if you're not a developer, these matter. Tag the issue `crisis-detector`.

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Short version: we work with vulnerable users at moments of emotional crisis. Be patient, be kind, and don't ship UX that someone in distress would mishandle.

## Development setup

```bash
git clone https://github.com/camster91/fernly.git
cd fernly
npm ci --legacy-peer-deps
npm run web      # or: npx expo start --web --port 8084
```

Node 20 (`.nvmrc`) and npm 10+. Both are pinned in `package.json:engines`.

**Note on the legacy-peer-deps flag:** the dependency baseline currently pins
`eslint@^10.8.0` (from a Dependabot bump) while `@react-native/eslint-config@0.86.1`
peers on `eslint@^8 || ^9`. This is tracked in issue #58; the install flag
works around the conflict until the upstream is fixed.

## Workflow (issue-based delivery)

The repo uses an **issue-based delivery workflow** (issue #65). Every code
change starts from a numbered GitHub issue and follows the same path.

### Branch naming

```
agent/<issue-number>-short-description
```

Examples (from current branches on this repo):

- `agent/wave1-p0-quick-wins` (covers issues #54, #57, #66, #68, #72, #79, #80, #82)
- `agent/wave2-strict-storage-and-modal-exits` (covers #52, #69, #70, #81)
- `agent/58-restore-ci-baseline` (issue #58)

One branch per independently reviewable work slice. **One primary issue per
PR.** Multi-issue branches are OK for tightly coupled fixes; link the issues
in the PR description.

### Pull request lifecycle

1. **Draft by default.** Open the PR as a draft so CI runs but the review
   doesn't trigger yet. Mark ready only after the gates pass AND you've
   self-reviewed the diff.
2. **No direct pushes to `main`.** The `main` branch has branch
   protections; force-pushes to it are rejected.
3. **Close the issue only after every acceptance criterion passes in the
   target environment.** Don't auto-close on PR merge — verify on a
   device (or `expo export --platform web` for web-only fixes) and attach
   evidence (screenshots, terminal output, test IDs).
4. **New findings during delivery:** check open AND closed issues before
   creating a child issue. Avoid duplicates.

### Required PR description sections

1. Linked issue and intended outcome
2. Scope
3. Out of scope
4. User-visible behavior and required states
5. Automated verification (`npm run ci`)
6. Manual verification and screenshots
7. Security and privacy review
8. Accessibility review
9. Responsive, performance, and compatibility review
10. Data migration, rollback, and recovery
11. Dependencies, credentials, external services, and approvals
12. Known risks, deferred work, and target-environment acceptance

### Required verification (run before marking the PR ready)

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format:check # prettier --check
npm run test         # vitest suite (187 tests across 4 files)
npx expo export --platform web   # verifies the web build
```

For mobile-affecting work, the additional `expo prebuild --platform ios` /
`expo prebuild --platform android` checks verify the native config hasn't
drifted from `app.json`.

### Release workflow (separate from delivery)

The release pipeline (`.github/workflows/release.yml`) is governed by
issue #53 and the `RELEASING.md` runbook. Release workflow changes go
through the same issue-based flow as any other change — they do NOT
bypass review by virtue of being release automation.

### Emergency exception procedure

If a critical fix must land outside the normal review flow, the owner
documents the exception in the PR with:

- Approver
- Audit trail (timestamp + reason)
- Expiry (follow-up issue before this expires)
- Follow-up issue link

This is narrow, time-limited, and auditable. The default path is
"open a PR, follow the workflow, merge when green."

## Code conventions

- TypeScript strict mode is enforced. We turn on additional flags (noUncheckedIndexedAccess, exactOptionalPropertyTypes) gradually — see the current `tsconfig.json`.
- Theme tokens live in `src/theme.ts`. No bare hex literals in `src/` (the ESLint rule catches 6-digit hex; rgba strings still slip through — human review).
- Date handling goes through `src/util/date.ts` (`localDateString` / `parseLocalDate`). Direct `toISOString().slice(0, 10)` calls in screens are a UTC bug.
- Async storage goes through `src/storage.ts`. Direct `AsyncStorage` calls in screens skip the audit-log + migration logic.
- The crisis detector is documented inline in `src/safety/crisis.ts`. The
  pattern corpus lives in `src/util/__tests__/crisis.detector.test.ts` —
  add a test case whenever you add or change a pattern.

## Project structure

```
fernly/
├─ App.tsx                       # top-level wrapper (ErrorBoundary, phone-frame on web)
├─ index.ts                      # Expo registerRootComponent
├─ src/
│  ├─ components/                # Card, ScreenContainer, CrisisModal, MoodPicker, ErrorBoundary
│  ├─ screens/                   # 8 screens (Today, Chat, Practice, Insights, Profile,
│  │                             #   Onboarding, MoodCheckIn, Exercise, Settings)
│  ├─ nav/RootNav.tsx            # navigation (gate + tab + modal stack)
│  ├─ storage.ts                 # AsyncStorage + SecureStore (typed, schema-versioned)
│  ├─ safety/crisis.ts           # detector (clinical-UX-critical)
│  ├─ api/chat.ts                # chat backend adapter
│  ├─ theme.ts                   # color/space/type tokens
│  ├─ data/                      # exercises, mascots
│  ├─ util/                      # date helpers (localDateString / parseLocalDate)
│  ├─ util/__tests__/            # vitest for util + crisis detector
│  └─ __tests__/                 # vitest for storage + chat API
├─ plans/                        # audit + kanban docs
├─ spec/                         # UI design mock (spec/index.html) + 30 screen mocks
├─ app.json                      # Expo config
├─ tsconfig.json
├─ eslint.config.js
└─ package.json
```

## Triage etiquette

GitHub Issues triage is human-first. Bot-flagged issues (from the audit process) get a `P{n}` label by severity and category, plus `code-quality` / `a11y-ux` / `devops`. We close-as-completed rather than close-as-wontfix when the issue is real but fixed out of band; the audit history in `plans/` always has the trail.

## Where to ask questions

- Anything not on a critical path: open a `discussion:` issue. We don't have GH Discussions enabled yet.
- Anything on a critical path: Discord/Slack not configured. Open an issue and tag `@camster91`.
- For an active PR: comment in the PR.
