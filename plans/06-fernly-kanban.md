# Fernly — Kanban Board

**Repo:** `camster91/fernly` @ `main` (commit `3f61673`+ on 2026-07-22)
**Branch baseline:** 13 PRs merged; ahead of origin by 59+ commits
**Stack:** Expo SDK 57, RN 0.86, React 19.2, TypeScript 6.0.3, AsyncStorage
+ expo-secure-store

Last full audit: **`plans/05-full-codebase-review-2026-07-22.md`** (8 P0,
20 P1, 22 P2/P3 findings). 12 of those have shipped across PRs 1-13.
This board tracks the remaining ~30 items, plus ad-hoc work identified
during the UX review cycle and during the codebase-improvement arc.

## Open GitHub items (live)

| # | Title | Notes |
|---|---|---|
| **PR #29** | `chore(deps)`: react-navigation group (3 updates) | Open. `gh pr merge --auto` after CI green. |
| **PR #30** | `chore(deps-dev)`: tsx 4.23.0 → 4.23.1 | Open. patch bump; safe. |
| **PR #31** | `chore(deps-dev)`: eslint 9.39.5 → 10.7.0 | Open. major bump — may need rule fixes. |
| **PR #32** | `chore(deps)`: react-dom 19.2.3 → 19.2.7 | Open. (We already bumped to 19.2.7 in PR UX8 — this may now conflict.) |
| **PR #33** | `chore(deps-dev)`: typescript 6.0.3 → 7.0.2 | Open. major bump — may break the codebase. |

**Issues:** 0 open. All 4 historical issues are closed.

---

## Local backlog (categorized from plans/05)

### 🔴 P0 — Ship-blockers

#### Sprint 1 (this week)

| ID | Title | Plan ref | Status | Est |
|---|---|---|---|---|
| F-P0-1 | **App Store / TestFlight pipeline** — remove unused mic + speech plist entries from `app.json`; add `expo prebuild` to CI; align `app.json:5` (0.1.0) and `package.json:3` (1.0.0) versions; write release process | plans/05 P0-7, P0-8 | **todo** | 6h |
| F-P0-2 | **Sentry / ErrorBoundary follow-on** — wire `sentry-expo`, replace `console.error` in `ErrorBoundary.componentDidCatch` with `Sentry.captureException`; add source maps; alerting rules for crisis-detector false positives | plans/05 C3 | **todo** | 4h |
| F-P0-3 | **Mock LLM ready hook** — current chat runs on `mockReply()` deterministic hash. When the LLM endpoint ships, swap `mockReply` for an `AbortController` + `fetch()` (ref `src/screens/ChatScreen.tsx:218`). Test double currently produces *bad* UX (same response every time) | roadmap | **todo** | 8h |

### 🟡 P1 — Should fix before TestFlight

#### Sprint 2 (next week)

| ID | Title | Plan ref | Status | Est |
|---|---|---|---|---|
| F-P1-1 | **ChatScreen message order** — FlatList is `inverted={true}` but data is appended oldest-first. Restore-after-render reads as reversed. Decide: drop `inverted`, scroll-to-end on mount, OR pass memoized newest-first array | plans/05 P1-12 | **todo** | 2h |
| F-P1-2 | **Crisis detector hardening** — 21 still-failing cases in `test-crisis-edge-cases.mjs`. Priority: Portuguese ("não aguento mais viver"), soft ideation ("I'm so tired of being tired"), the permadeath false positive, "30 pills" no match, "bridge and jump" no match. Each → dedicated regex + test | plans/05 backlog | **todo** | 6h |
| F-P1-3 | **`npm audit` step in CI** — add `npm audit --omit=dev --audit-level=high` after `npm ci` on `.github/workflows/ci.yml:31` (per DevOps C1) | plans/05 C1 | **todo** | 1h |
| F-P1-4 | **Web bundle size budget** — `.github/workflows/ci.yml:80-85` echoes size but never fails. Parse bytes, compare against 928KB baseline, fail on `> 1.5x` | plans/05 C2 | **todo** | 1h |
| F-P1-5 | **`engines` field + `.nvmrc`** — `package.json` should declare `"engines": { "node": ">=20.0.0", "npm": ">=10.0.0" }`; create `.nvmrc` with `20`. CI uses 20; contributors on Node 18 see different behavior | plans/05 P2-5 | **todo** | 30m |
| F-P1-6 | **TypeScript strict flags** — add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitOverride` to `tsconfig.json`. Each would catch real bugs in the existing code (e.g. `WEEKDAYS[i]` out-of-bounds) | plans/05 P1-18 | **todo** | 3h |
| F-P1-7 | **PracticeScreen — 8 exercises, 7 are stubs** — visually disabled cards + a clear "Available now" feature of Box Breathing would reduce disappointment. Add a "1 of 8 available" subtitle and badge | plans/05 P2-18 | **todo** | 1h |
| F-P1-8 | **ChatScreen error UX edge** — bubble order + restore-after-error. (Already shipped draft restoration in P1-11; visual confirmation in chat-history view still needs verification.) | plans/05 P1-11 | **todo** | 1h |

#### Sprint 3 (week after)

| ID | Title | Plan ref | Status | Est |
|---|---|---|---|---|
| F-P1-9 | **`expo-secure-store` → AsyncStorage parity** — chat history persistence works on iOS/Android but is lossy on web (the audit caught this). Either document the divergence or fix it by routing SecureStore on web to AsyncStorage with encryption-at-rest | prior UX review | **todo** | 3h |
| F-P1-10 | **Crisis-validated harmony across screens** — the `verifiedUrls` Map is module-scoped, doesn't persist. Every cold launch shows the spurious "resources may be unavailable" banner. Persist with TTL | plans/05 P1-6 | **todo** | 2h |
| F-P1-11 | **Memoize `pickLocale()`** — `src/components/CrisisModal.tsx:67` runs every render with `getLocales()` cold-call. `useMemo` on `[locale]` makes the modal less janky during rapid state updates | plans/05 P1-4 | **todo** | 30m |
| F-P1-12 | **`tsconfig.json` + `eslint.config.js` cleanup** — drop the stale `PracticeScreen.tsx` `no-restricted-syntax` exclusion (comment says PR #13 removed it). Replace repo-wide disable of `react/no-unstable-nested-components` with targeted inline disables | plans/05 P1-16, P2-3 | **todo** | 1h |
| F-P1-13 | **Migration-readiness for imported user data** — Settings export JSON ships today; import doesn't. Sketch spec only | future | **backlog** | — |

### 🟢 P2 — Polish (next 2-4 weeks)

| ID | Title | Plan ref | Status | Est |
|---|---|---|---|---|
| F-P2-1 | **Insights chart Y-axis labels** — chart shows movement but users can't tell whether a point is 2/6 or 5/6. Add axis tick labels 1-6 | plans/05 P2-19 | **todo** | 1h |
| F-P2-2 | **`rgba(42, 36, 56, 0.85)` inline literal** in CrisisModal — bypasses the locked hex contract. Add a `colors.scrim` or `colors.overlay` token | plans/05 P2-1 | **todo** | 30m |
| F-P2-3 | **`firstRun` zero-stats deferral** — ProfileScreen shows "0 / 0 / 0" right after onboarding, looks evaluative. Defer stats until first activity | plans/05 P2-21 | **todo** | 1h |
| F-P2-4 | **Launch spinner polish** — `RootNav.tsx:113-119` blank loading state. Add brand mark + "Loading your space" + a11y progress label | plans/05 P2-22 | **todo** | 1h |
| F-P2-5 | **Quick-pill touch targets** — `ChatScreen.tsx:407-417` quick-pill controls measure ~36-40pt. Set `minHeight: 44` for AA-target compliance | plans/05 P2-17 | **todo** | 30m |
| F-P2-6 | **`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`** — standard repo hygiene. SECURITY.md is critical because the app handles crisis-flagged text | plans/05 P2-8 | **todo** | 1h |
| F-P2-7 | **`CODEOWNERS`** — `src/safety/` + `src/components/CrisisModal.tsx` should be owned by a human (not an AI agent) | plans/05 P2-9 | **todo** | 30m |
| F-P2-8 | **`expo-updates` (OTA)** — for a v0 alpha shipping weekly, OTA over the JS bundle is the fastest iteration loop until EAS Build exists | plans/05 P2-7 | **backlog** | — |
| F-P2-9 | **Spec adherence audit** — `spec/index.html` is 2,441 lines; full visual diff vs implementation. Inter font vs System font; TBD | plans/05 spec | **todo** | 4h |
| F-P2-10 | **Tab iconography refresh** — emoji icons work but tasteful SVG/Unicode glyphs would scale. Tab bar already has 4-tab a11y labels | plans/05 polish | **backlog** | — |
| F-P2-11 | **Empty-Insights CTA** — when 0 mood entries, "Log today's mood" button instead of just an empty grid | plans/05 P2-20 | **todo** | 30m |

### ⚪ Review / Follow-up

| ID | Title | Plan ref | Status | Est |
|---|---|---|---|---|
| F-R-1 | **External security/clinical review** — wellness apps handling crisis text + clinical UX (CBT/ACT) need a licensed reviewer sign-off before App Store submission. NOT in scope for this repo; track in `review-pipeline` | external | **backlog** | — |
| F-R-2 | **`Sentry.replay` for crisis-modal interactions** — when crash-reporting lands, capture the user's last few screens leading up to a crisis-modal open. Provides clinical post-mortem data | after P0-2 | **backlog** | — |

---

## Wave plan (suggested)

**Wave 1 (4-6h) — unblock CI + ship-readiness:**
- F-P1-3 (npm audit)
- F-P1-4 (bundle budget)
- F-P1-5 (engines + .nvmrc)
- F-P1-6 (tsconfig strict flags)

**Wave 2 (10h) — TestFlight / App Store pipeline:**
- F-P0-1 (release process + prebuild CI + version alignment)

**Wave 3 (10h) — safety surface polish:**
- F-P1-2 (21 crisis edge cases — split across multiple PRs)
- F-P1-10 (verifiedUrls persistence)
- F-P1-11 (pickLocale memoization)
- F-P2-2 (scrim token)

**Wave 4 (8h) — UX polish:**
- F-P1-7 (PracticeScreen legend)
- F-P1-1 (ChatScreen message order)
- F-P2-1 (Insights Y-axis)
- F-P2-3 (first-run stats deferral)
- F-P2-4 (launch spinner)
- F-P2-5 (quick-pill touch targets)
- F-P2-11 (Insights empty CTA)

**Wave 5 (deferred):**
- F-P0-2 (Sentry)
- F-P0-3 (real LLM chat)
- F-P2-6/7/8/9/10 (long-tail polish)
- F-R-1/2 (external review)
