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
npm ci
npm run web      # or: npx expo start --web --port 8084
```

Node 20 (`.nvmrc`) and npm 10+. Both are pinned in `package.json:engines`.

## Workflow

1. Create a branch from `main`:
   - `fix/<short-name>` for bug fixes
   - `feat/<short-name>` for features
   - `chore/<short-name>` for tooling, deps, docs

2. Make your change. Run the gates:

   ```bash
   npm run typecheck    # tsc --noEmit
   npm run lint         # eslint
   npm run format       # prettier --write
   npm test             # vitest + crisis corpus
   ```

3. Verify the web export builds:

   ```bash
   npx expo export --platform web
   ```

4. Open a PR with:
   - The behavioral diff (if any)
   - Test additions or rationale for omission
   - Screenshots for any UI change

## Code conventions

- TypeScript strict mode is enforced. We turn on additional flags (noUncheckedIndexedAccess, exactOptionalPropertyTypes) gradually — see the current `tsconfig.json`.
- Theme tokens live in `src/theme.ts`. No bare hex literals in `src/` (the ESLint rule catches 6-digit hex; rgba strings still slip through — human review).
- Date handling goes through `src/util/date.ts` (`localDateString` / `parseLocalDate`). Direct `toISOString().slice(0, 10)` calls in screens are a UTC bug.
- Async storage goes through `src/storage.ts`. Direct `AsyncStorage` calls in screens skip the audit-log + migration logic.
- The crisis detector is documented inline in `src/safety/crisis.ts`. **Don't add patterns without updating `scripts/test-crisis-edge-cases.mjs`** — the corpus is the spec.

## Project structure

```
fernly/
├─ App.tsx                       # top-level wrapper (ErrorBoundary, phone-frame on web)
├─ index.ts                      # Expo registerRootComponent
├─ src/
│  ├─ components/                # Card, ScreenContainer, CrisisModal, etc.
│  ├─ screens/                    # 8 screens + SettingsScreen
│  ├─ nav/RootNav.tsx            # navigation
│  ├─ storage.ts                  # AsyncStorage + SecureStore
│  ├─ safety/crisis.ts            # detector (clinical-UX-critical)
│  ├─ theme.ts                    # color/space/type tokens
│  ├─ data/                       # exercises, mascots
│  ├─ util/                       # date helpers (today: date.ts)
│  └─ __tests__/                  # vitest
├─ scripts/                       # crisis mjs runners + edge-cases
├─ plans/                         # audit + kanban docs
├─ spec/                          # UI design mock (spec/index.html)
├─ app.json                       # Expo config
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
