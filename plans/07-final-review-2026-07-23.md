# Fernly — Final Review (2026-07-23, end-of-arc)

Captures the state of `camster91/fernly` at the close of the
codebase-improvement arc. Gates green, 22 of 34 kanban items
shipped, no security-critical regressions.

## TL;DR — ship-readiness

| Surface | Status | Notes |
|---|---|---|
| App boots, all 8 screens render | ✅ | Phone-frame on web + native iOS/Android |
| Type check, lint, format | ✅ | All 0 errors / 0 warnings |
| Tests | ✅ 77 total | 21 storage + 13 date + 43 crisis (+ 2 todo), 75 pass + 2 todo + 0 fail |
| Web export | ✅ 1.3 MB | sentry-expo shipped, pre-arc was 912 KB |
| React Native prebuild | ✅ | New CI job (`ci.yml:64-135`) verifies native config hasn't drifted |
| Crisis detector false-positive rate | ✅ Mitigated | v0.8 `I'm glad to be alive` regression closed; new bypass coverage |
| Crisis detector false-negative rate | ⚠ Partial | Portuguese pt-BR now covered; "ceiling myself" and "k1ll m3" hybrid are still gaps (tracked as `it.todo` in tests) |
| Settings screen | ✅ | Mast, tone, goals editor + JSON export + legal |
| Sentry | ✅ Integration only | Real DSN env not set; placeholder guard in place |
| AsyncStorage date integrity | ✅ | localDateString util — fixed UTC corruption across all 7 mood history callsites |
| Onboarding | ✅ | Step 5 Begin works (off-by-one fixed). Step 2 mood pick persists |
| TypeScript strict flags | ✅ Safe subset | `noFallthroughCasesInSwitch`, `noImplicitOverride`. Deferred `noUncheckedIndexedAccess` (touches ~50 sites) |

## Live counts (this arc)

| Axis | Before arc | After arc | Delta |
|---|---|---|---|
| Local commits on main | 14 | 116 | +102 |
| Source LOC | 4,275 | ~5,700 | +1,400 (incl. SettingsScreen ~340 lines) |
| Test cases | 21 (storage only) | 75 (+ 2 todo) | +54 |
| Vitest files | 1 | 3 | +2 |
| CI jobs | 3 (quality, web-bundle, expo-doctor) | 4 (+ prebuild) | +1 |
| Bundle size baseline | 912 KiB → 1,824 KiB budget | 1.3 MB (under 2x) | within bounds |
| Kanban items tracked | 0 | 34 | +34 |
| Open GitHub issues | 4 historical | 0 | All closed in earlier audit |

## Files changed in this arc (commit-by-commit high-level)

- **`docs/SECURITY.md`** — new. Crisis-domain reporting flow.
- **`docs/CONTRIBUTING.md`** — new. Gate conventions, branch naming, command paths.
- **`docs/CODE_OF_CONDUCT.md`** — new. Adapted Contributor Covenant + crisis-domain specifics.
- **`CODEOWNERS`** — new. Safety surface owned by human not AI.
- **`App.tsx`** — `ErrorBoundary` wrap, phone-frame on web, Sentry init slot.
- **`src/components/ErrorBoundary.tsx`** — `forwardRef`, log on dev / send to Sentry on prod.
- **`src/components/Card.tsx`** — `accessibilityRole="button"` + `accessibilityLabel` + `accessibilityHint` on actionable rows; dev-mode console.warn.
- **`src/components/CrisisModal.tsx`** — verbose `useEffect` cleanup, `pickLocale` memo at module load, screen-reader announcement, JSDoc on every behavior field.
- **`src/components/MoodPicker.tsx`** — `accessibilityRole`, message-level cross-screen usage.
- **`src/data/mascots.ts`** — new. Shared `MASCOT_EMOJI` map + fallback constant.
- **`src/data/exercises.ts`** — unchanged but referenced more.
- **`src/screens/*`** — improved 8 of 8 screens:
  - ChatScreen: scroll-to-end + `Jump-to-new` pill, single-flight session create, ref-based isSending guard, draft-restoration on error.
  - TodayScreen: `Good {timeOfDay}, {name}.` greeting, `STARTED {mood}` for streak-0 users, color-blind streak dot.
  - MoodCheckInScreen: dynamic greeting eyebrow, accessible pill rows.
  - ExerciseScreen: 15-cycle box-breathing (was infinite loop), haptic on phase transition.
  - PracticeScreen: `1 available now` / `7 coming soon` legend.
  - InsightsScreen: dashed tier gridlines + `1 = low / 6 = high` legend, `Log today's mood` empty CTA.
  - ProfileScreen: `Reset` alert now discloses audit-log retention + surfaces delete failures, `Welcome 🌱` card for first-run.
  - SettingsScreen: new — mascot/tone/goals editor + JSON export + Legal modal.
  - OnboardingScreen: fixes Step 2/5 bugs, persists initial mood.
- **`src/nav/RootNav.tsx`** — `LoadingScreen` with brand mark + progressbar a11y, Settings route registration.
- **`src/safety/crisis.ts`** — 20+ new patterns (offing/ceiling, CTB, method+intent, pt-BR), Unicode separator-collapse, removed regression `so tired` from false-positive guard.
- **`src/storage.ts`** — `verifiedUrls` persistence API + `hydrateVerifiedUrls()` + `appendChatSessionKey` improvements.
- **`src/theme.ts`** — `colors.scrim` token, font deferral documentation.
- **`src/util/date.ts`** — new. `localDateString()` / `parseLocalDate()` + timezone-safe tests.
- **`src/__tests__/*`** — 3 vitest files now. Added `crisis.detector.test.ts` (the previously-unrunnable mjs corpus).

## What I would NOT have caught without the arc

A few things only became visible by running the same code on different surfaces:

1. **Onboarding step off-by-one.** Without literally tapping through the flow in the browser, the bug wouldn't have surfaced — the test corpus didn't include it.
2. **AsyncStorage UTC corruption.** Single-line `toISOString().slice(0,10)` bug that affects every PST/EST/JST user invisibly. Found via the audit, not by reading code.
3. **"k y s" / "k1ll m3" separator-collapses.** A pre-arc normalizer only handled `k.m.s` patterns in ASCII. The detector was stronger in theory than practice.
4. **ProfileScreen reads from cache after Reset.** Old code never re-read storage after the reset event emitted; useFocusEffect fix only surfaced when we manually walked the flow.
5. **`Mock LLM` deterministic outputs.** The shipped `mockReply` is a hash-deterministic function, so two consecutive identical messages get identical responses. Looks broken to the user even though it's "working." Critical-UX bug; out of arc but flagged in plans/06.

## Risks worth flagging to your reviewer

- **Bundle size +380 KB** with sentry-expo. Web bundle is 1.3 MB vs. pre-arc 912 KB. Real-device render-cost impact unknown; gate is `web-bundle` job in CI but doesn't fail on the delta.
- **`react-dom@19.2.7` and `react@19.2.7` both pinned.** Earlier drift between them crashed the bundle. CI now runs `expo export --platform web` which would catch this; we manual-pinned in 7863ce8.
- **ErrorBoundary hooks into Sentry Native.captureException.** If sentry-expo major-updates and the shape changes, the ErrorBoundary silently no-ops (try/catch wraps it). No test ensures Sentry is wired up at runtime — only that the no-op fallback exists.
- **`Selected-Tag {justifyContent: 'space-between'}`** layout in settings depends on TWO-`<Text>`-per-row. Adding a third line silently collapses to the third only. Not currently a bug but a smell.
- **`parsedLocalDate()` returns `null` on bad input** — caller in storage.test.ts was patched to handle. Other callers (none currently) need the same guard.

## What I'd do differently next time

1. **Render the app in a real device on every PR.** The "browser test" loop caught 70% of UX issues. The remaining 30% (button sizing on smaller Android devices, iOS-safe-area overlap) needs a phone.
2. **Run the test corpus through vitest from day 1.** Would have saved 3h of "the mjs script doesn't run in this env" debugging.
3. **Have a kanban BEFORE the audit.** I retroactively loaded the camster91-kanban skill mid-arc; the next arc loads it from session-start.
4. **Reject the "spec-alignment" codepath for typography.** Adding 80 KB of Inter to ship a font is a v1, not v0.

## Open items by agent (next arc owners)

- **code-reviewer:** the 5 dependabot PRs (#29–#33) are auto-merge candidates; #31 (eslint 10) and #33 (typescript 7) are majors and need a careful review.
- **code-reviewer:** F-P1-2 follow-ups — the `k1ll m3` normalizer and the "ceiling myself" clinical review (documented in `it.todo` in `src/util/__tests__/crisis.detector.test.ts`).
- **human-needed:** F-P0-1 (TestFlight pipeline release side). Workflow template at `~/.hermes/kanban/_pause_reference_release_yml.md`.
- **human-needed:** F-R-1 (external security + clinical review). Cannot be done in-arc.
- **code-reviewer:** F-P0-3 (real LLM chat). Requires backend project existence.

## Sign-off for this arc

`main` is healthy: type-safe, lint-clean, tests green, builds. Ready for external review. If a green-light comes back from F-R-1, the next two-line commit (`git push` + `git tag v0.9.0`) is the entire external release.
