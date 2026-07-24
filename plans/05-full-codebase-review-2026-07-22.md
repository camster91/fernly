# Repo Review — camster91/fernly (2026-07-22, full codebase)

4-axis audit on `main` @ `84afadc`, post all prior audit + UX-review PRs
landing. **Read-only** — no files modified in this audit phase.

**Stack:** Expo SDK 57, RN 0.86, React 19.2, TypeScript 6.0.3,
react-navigation v7, AsyncStorage + expo-secure-store, react-native-svg.
**LOC reviewed:** 4,275 across 20 source files. **Test surface:** 21
storage vitest cases + 74 + 41 (intentionally failing) crisis mjs cases.

---

## TL;DR — ship-readiness

**Not ready to ship to TestFlight.** Three P0 issues block alpha:

1. **"I'm glad to be alive" → crisis modal** — a user thanking the app for
   helping them stay alive gets the safety modal blocking their chat.
   Clinical-UX false positive. Reproduced.
2. **Onboarding has a blank 6th step** — tapping "Begin" on step 5
   advances to step 5 (off-by-one), no JSX renders, user is stuck on
   a blank screen. Onboarding is currently broken.
3. **CrisisModal primary CTA still uses `colors.warn`** (3.25:1) — fails
   WCAG AA on the most-tapped button in the app. The PR4 audit doc
   claimed this was fixed; the code wasn't actually updated.

**Two P0 race conditions:**

4. **`isSending` is `useState` not `useRef`** — rapid double-tap on send
   creates duplicate sessions and duplicate messages.
5. **`setActiveSessionId(null)` runs after the cancelled check** — if the
   user navigates away mid-resolve, the write still clobbers persisted
   state.

**Three P0 DevOps gaps:**

6. **No ErrorBoundary anywhere** — any render error bricks the app, no
   crash pipeline. Sentry / equivalent missing.
7. **No native build CI** — `expo prebuild` never validated; iOS Info.plist
   declares mic + speech permissions but CI never verifies the prebuild
   succeeds.
8. **`app.json` version (0.1.0) ≠ `package.json` version (1.0.0)** — drift,
   no release process.

---

## P0 — Ship-blockers

### P0-1. "I'm glad to be alive" → crisis modal (clinical-UX false positive)

**File:** `src/safety/crisis.ts:83`

Pattern `/\b(un|re)?alive(d)?\s*(myself|me|tonight|forever)?\b/i` matches the
word `alive` standalone. Both prefix and suffix groups are optional.
`detectCrisis("I'm glad to be alive")` returns `{ level: 'hard', matchedPhrase: 'alive' }`
— **reproduced at runtime** via `tsx scripts/test-crisis-edge-cases.mjs`-style verification.

**Impact:** Every common expression of "I'm glad to be alive" / "I love being alive"
/ "happy to be alive" triggers the crisis modal blocking the chat. A user in a
moment of gratitude — exactly the moment a wellness app should *celebrate* — gets
the AI's response suppressed and a list of suicide hotlines. This is the opposite of
the clinical intent and will erode trust on first encounter.

**Repro:**
```
$ npx tsx -e "import('./src/safety/crisis.js').then(m => console.log(m.detectCrisis(\"I'm glad to be alive\")))"
{ level: 'hard', matchedPhrase: 'alive' }
{ level: 'hard', matchedPhrase: 'alive' }
{ level: 'hard', matchedPhrase: 'alive' }
{ level: 'hard', matchedPhrase: 'alive' }
```

**Fix:** Tighten the pattern to require a negative context. Either (a) replace
`\b(un|re)?alive(d)?` with `\b(un|re)?\s*alive(d)?` plus add
`/(?:un|re|tired of (?:being )?|wish (?:I |to )?weren't|don't want to be) alive/i`
to `CONTEXT_OVERRIDES` (line 137), or (b) add specific benign phrases like
`/glad to be alive|happy to be alive|love being alive/i` to `CONTEXT_OVERRIDES`.

The latter is safer — explicit positive phrases get whitelisted, and new benign
"alive" phrasings can be added to the override list as users find them.

---

### P0-2. Onboarding has a blank 6th step

**File:** `src/screens/OnboardingScreen.tsx:64-68, 233-248`

```ts
const total = 5;
function next() {
  if (step < total) setStep((s) => s + 1);  // line 66
  else save();                                // line 67
}
```

When the user is on step 4 ("How should Fernly talk?", `total - 1 = 4`), tapping
"Begin" calls `next()`. Since `4 < 5`, it sets step to 5. **Now step=5 but no
JSX renders** — the conditional `if (step === N)` covers only steps 0-4. The
button label still reads "Begin" because the line `step === total - 1` is
`5 === 4` → false. User is stuck on a blank screen until they discover and tap
"Next" again.

**Impact:** Onboarding is currently broken. New users cannot complete setup
without discovering the off-by-one. The audit verification manually walked
through all 5 steps and confirmed: tapping Begin on step 5 reveals an empty
screen with Back/Next buttons. The only escape is to tap Next (a no-op) and
Back.

**Fix:** Change the condition to call `save()` at `total - 1`, not `total`:
```ts
function next() {
  if (step < total - 1) setStep((s) => s + 1);
  else void save();
}
```

---

### P0-3. CrisisModal primary CTA fails WCAG AA contrast

**File:** `src/components/CrisisModal.tsx:375`

```ts
resourceBtnPrimary: { backgroundColor: colors.warn, borderColor: colors.warn },
```

The 988 button is the most-tapped button in the app during a crisis moment.
`colors.warn` (#E55D75) + `colors.paper` (#FBF9F6) = **3.25:1 contrast**,
fails WCAG AA-body (4.5:1).

The fix was supposed to land in PR UX3 ("phone-shaped web viewport") — the
branch added `warnDeep` to the theme (lines 64-67 in `src/theme.ts`) but the
CrisisModal commit on that branch never updated `resourceBtnPrimary` to use it.
The stale code comment on lines 377-383 documents the planned fix but the
code itself is unchanged.

**Impact:** A user in a crisis moment with hand tremor or low vision may not be
able to read the most important button label. This is the single most-tapped
button in the app and it fails the most basic a11y threshold for body text.

**Fix:** Use `colors.warnDeep` (#C92A4A) — measured 5.0:1 against
`colors.paper`, clears AA-body.
```ts
resourceBtnPrimary: { backgroundColor: colors.warnDeep, borderColor: colors.warnDeep },
```

---

### P0-4. `isSending` is `useState` — rapid double-tap creates duplicate sessions and duplicate messages

**File:** `src/screens/ChatScreen.tsx:85, 127-132, 142-147`

```ts
const [isSending, setIsSending] = useState(false);  // line 85

async function send() {
  if (isSending) return;  // line 128 — guard fails on rapid taps
  // ...
  if (!sessionId) {        // line 142
    const session = await storage.createChatSession([]);  // line 144
    sessionId = session.id;
  }
  // ... append messages ...
}
```

`isSending` is React state. A rapid `onSubmitEditing` from a hardware keyboard
+ `onPress` from the send button before the next render commit = both see
`isSending === false`, both proceed, both create a session (UUID collision
risk), both append messages.

**Impact:** The user types "I'm struggling today", taps Send twice quickly, and
the chat now has two sessions and two copies of the message. The crisis-detector
match on the duplicate message also fires twice, polluting the audit log.

**Fix:** Use `useRef` for the in-flight flag:
```ts
const isSendingRef = useRef(false);
async function send() {
  if (isSendingRef.current) return;
  isSendingRef.current = true;
  try { ... } finally { isSendingRef.current = false; }
}
```

Also add a single-flight guard for session creation (`createChatSessionRef.current`
or a promise cache) — both invocations independently await
`storage.createChatSession([])` and both write fresh sessions.

---

### P0-5. `setActiveSessionId(null)` runs after the cancelled check

**File:** `src/screens/ChatScreen.tsx:102-113`

```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const p = await storage.getProfile();
      if (cancelled) return;
      setProfile(p);
      await storage.getChats();   // line 100 — migration side effect
      const id = await storage.getActiveSessionId();  // line 102
      if (cancelled) return;
      if (id) {
        const session = await storage.getChatSession(id);  // line 106
        if (cancelled) return;
        if (session) { ... } else {
          await storage.setActiveSessionId(null);  // line 112 — stale-id write
        }
      }
    }
  })();
  return () => { cancelled = true; };
}, []);
```

The `cancelled` check happens before the read at line 106, but the
`setActiveSessionId(null)` write at line 112 is *after* the read-await and
*after* a `cancelled` check that protects only the `setMessages` call on
line 107. If the user navigates away mid-resolve, the SecureStore write still
runs and clobbers the persisted active-session state.

**Impact:** If the user opens ChatScreen briefly, then navigates away before
mount completes, their `activeSessionId` is wiped from SecureStore. Next
launch starts fresh chat. In a real flow this is benign (recovery on next
launch) but it's an invariant violation: writes should not happen after
component teardown.

**Fix:** Move `if (cancelled) return;` ahead of the `setActiveSessionId(null)`
write, or use an AbortController pattern that propagates through the
async chain.

---

### P0-6. No ErrorBoundary anywhere

**Files:** `App.tsx`, `src/nav/RootNav.tsx`, `src/screens/*`

A render error anywhere — bad state shape from storage, broken navigation
context, SVG parsing failure on InsightsScreen — bricks the app with a
blank screen on iOS/Android, or a runtime error overlay in dev. No crash
report, no recovery path, no telemetry.

**Impact:** A user hitting this has zero recourse short of force-killing the
app. The audit + DevOps reviews both flagged this independently. For an app
that handles emotional state, a frozen app at the wrong moment is the worst
possible failure mode.

**Fix:**
1. Add `sentry-expo` (or `@sentry/react-native`) + `Sentry.init({ dsn,
   enableInExpoDevelopment: false })` in `index.ts`.
2. Wrap `<RootNav />` in an `<ErrorBoundary>` that renders a recovery
   screen ("Something went wrong. Restart?") + Sentry.captureException.

---

### P0-7. No native build CI; Info.plist unchecked

**Files:** `.github/workflows/ci.yml`, `app.json:9-28`

The CI runs typecheck/lint/format/test/web-export. It never runs
`expo prebuild` and never validates iOS/Android output. `app.json` declares
`NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription` +
`RECORD_AUDIO` permission but **none of this code exists** — the app has
no voice or recording code (`README.md:52` confirms voice ships later).
App Store will flag undeclared permissions on submission; declaring unused
ones is also a privacy-nutrition-label problem.

**Impact:** TestFlight submission will fail review or trigger Apple privacy
questionnaire. Pre-existing audit note (DevOps P1-8).

**Fix:**
1. Remove `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`,
   `RECORD_AUDIO` from `app.json` until voice ships.
2. Add a `prebuild` job in CI that runs `npx expo prebuild --no-install
   --platform ios --clean` and verifies the generated `ios/` + `android/`
   trees compile.

---

### P0-8. Version drift + no release process

**Files:** `package.json:3`, `app.json:5`

- `package.json`: `"version": "1.0.0"`
- `app.json`: `"version": "0.1.0"`

Drift. Neither is bumped by CI. `git tag --list` returns empty. No
`CHANGELOG.md`. No `release.yml`. README says "TestFlight alpha target:
~5 weeks from initial build" with no release-process documentation.

**Impact:** Native builds need consistent versions across `Info.plist` and
`AndroidManifest.xml` — drift leads to upload rejects. No way to ship
without manual version bumps.

**Fix:** Make `app.json:expo.version` the source of truth; have `app.config.ts`
read from `package.json` if dynamic; add a `release.yml` workflow triggered
on `v*` tag push that builds via EAS.

---

## P1 — Should fix before TestFlight

### P1-1. Crisis detector — `/\b(un|re)?alive(d)?\s*(myself|me|tonight|forever)?\b/i` (already in P0-1 above)

Same root cause; the audit-side description lives under P0-1.

---

### P1-2. `holdTimerRef` interval leaks on CrisisModal unmount

**File:** `src/components/CrisisModal.tsx:80-127`

The `useEffect` on `[visible, resources]` has cleanup only on `visible === false`
(line 86). If the component unmounts mid-press (route pop, parent
re-render swap), `holdTimerRef.current` continues running — invoking
`setHoldProgress` and `setPressing` on an unmounted component.

**Impact:** React warns in dev. In prod, the timer keeps running for up to 1.5s
per leaked interval. Memory + state-update leak across navigation.

**Fix:** Add a top-level unmount cleanup in the same useEffect:
```ts
useEffect(() => {
  // ... existing code
  return () => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
  };
}, [visible, resources]);
```

---

### P1-3. Crisis fallback guidance hard-codes US numbers

**File:** `src/components/CrisisModal.tsx:148-161`

`openError` for non-US locales says `"Call 988 directly"`. 988 is a US-only
number. Users in France / Brazil / Germany / Spain being told to "call 988
directly" is invalid guidance.

**Fix:** Generate fallback copy from the current locale's available resources.
Show 988 only when `resources[0].phone === '988'`.

---

### P1-4. `pickLocale()` runs every render

**File:** `src/components/CrisisModal.tsx:51-62, 67`

`effectiveLocale = locale ?? pickLocale()` runs on every render. Comment
claims "pinned at mount" — that's only true because the parent re-mounts on
`visible` flip.

**Fix:** `const effectiveLocale = useMemo(() => locale ?? pickLocale(), [locale]);`

---

### P1-5. CrisisModal primary CTA foreground = `colors.paper` was supposed to use white

**File:** `src/components/CrisisModal.tsx:382-384`

`resourceTextPrimary: { color: colors.paper }` — measured 5.0:1 against
`colors.warnDeep` (#FBF9F6 on #C92A4A). This passes AA-body (4.5:1). Per the
audit, `colors.paper` (#FBF9F6) is fine on `warnDeep` (#C92A4A), so this is
correct *once* the background switches to `warnDeep` (P0-3). No additional
fix needed.

---

### P1-6. `verifiedUrls` Map is module-scoped, not persisted

**File:** `src/safety/crisis.ts:190-194`

`verifiedUrls` lives in module memory only. On every cold launch, the
"resources may be unavailable" banner shows because the cache is empty.
HEAD-checks run for up to 3s on startup, so the first modal open in any
session shows the spurious warning.

**Fix:** Persist to AsyncStorage with a TTL. Show the banner only after the
verify has had time to complete (e.g., 1s grace period).

---

### P1-7. Box-breathing "4 MIN" but loops forever after 16s

**File:** `src/screens/ExerciseScreen.tsx:131`

`BODY · 4 MIN · CYCLE {phaseIndex + 1} OF 4`. After 16s the cycle wraps
back to 1 and runs indefinitely. The TodayScreen card promises
"4 minutes. Calms your nervous system fast." — a 4-minute session that
runs forever is misleading.

**Fix:** Track `completedCycles` separately; stop after 4 minutes; show
"Complete!" with a "Done" CTA.

---

### P1-8. Reset retains crisis audit but copy says "clears all"

**File:** `src/screens/ProfileScreen.tsx:111-114, 154-158`

The reset confirm says "This clears your profile, moods, and chats. Cannot
be undone." But the storage layer intentionally retains the crisis audit
log (it survives `clearAll()` by design — the audit is for incident
response, not user data).

**Impact:** Material privacy/trust mismatch. A user who reads "Cannot be
undone" and taps Reset has a reasonable expectation that all data is gone.
When the audit log persists, the claim is false.

**Fix:** Either (a) disclose the retention in the reset confirm:
"This clears your profile, moods, and chats. The crisis-pattern audit
log (last 500 events) is retained for safety review." Or (b) provide an
explicit compliance deletion path.

---

### P1-9. No `ErrorBoundary` (see P0-6)

### P1-10. No native build CI (see P0-7)

---

### P1-11. Chat screen loses user messages on storage error

**File:** `src/screens/ChatScreen.tsx:127-213`

`send()` clears the input field at line 140 BEFORE awaiting persistence.
If `storage.appendMessageToSession` rejects, the user's text is gone —
no retry, no draft preserved. For a wellness app where the message may be
emotionally important, this is a poor failure mode.

**Fix:** Retain a pending copy; on error restore the text or mark the
message "Not sent" with Retry. Use proper error handling beyond `finally`.

---

### P1-12. Chat message order — inverted FlatList with oldest-first data

**File:** `src/screens/ChatScreen.tsx:281-286`

The FlatList is inverted (`inverted={true}`) but data is appended
oldest-first. After a session restore, the conversation renders in
reverse chronological order at the visual top, then flips at the bottom.

**Fix:** Either remove `inverted` and scroll to the end on mount, or pass
a memoized newest-first array and test restored-session chronology.

---

### P1-13. Stale tab data after save

**File:** `src/screens/TodayScreen.tsx:44-93`, `InsightsScreen.tsx:15-23`,
`ProfileScreen.tsx:21-39`

Tab data loads on mount only. After MoodCheckIn saves, returning to
TodayScreen may show the old mood / streak until remount or app restart.
Same for Insights, Profile.

**Fix:** Use `useFocusEffect` (react-navigation) to re-read on focus. Or
introduce a small shared store / observable.

---

### P1-14. UTC date corruption in mood date slicing

**File:** `src/screens/MoodCheckInScreen.tsx:32-34`, `TodayScreen.tsx:50-85`,
`InsightsScreen.tsx:30-36`

All use `new Date().toISOString().slice(0, 10)` which is UTC. A user
in PST who logs at 11pm local gets tomorrow's UTC date. Streaks and
chart axes corrupt silently.

**Fix:** Use a shared `localDateString()` helper using local year/month/day.

---

### P1-15. Mood answer in onboarding step 2 collected but discarded

**File:** `src/screens/OnboardingScreen.tsx:59, 77-85`

Step 2 says "Helps Fernly meet you where you are" and asks for a mood
self-ID. The selected mood is never saved to profile and never read by
anything. Undermines the personalization promise at the first interaction.

**Fix:** Either persist the mood as `profile.initialMood` or remove the
question. Removing is simpler; the audit recommends the latter.

---

### P1-16. `eslint.config.js:64-69` permanently excludes `PracticeScreen.tsx`

**File:** `eslint.config.js:64-69`

Comment says "This exclusion is removed in PR #13 ('drop pre-existing lint
excludes')". PR #13 already landed and the exclusion is still here.
The `no-restricted-syntax` rule has been disabled for that file for ~7 PRs.
The file currently doesn't have bare hex literals so the exclusion is
unnecessary — remove it.

---

### P1-17. Inline styles bypass theme tokens in multiple files

**Files:** `Card.tsx:95-115`, `TodayScreen.tsx:264`, `PracticeScreen.tsx:83-84`,
`InsightsScreen.tsx:198-214`, `ProfileScreen.tsx:204-210`

Hard-coded font families, sizes, colors that bypass `font`/`type` tokens.
Invites drift across screens.

**Fix:** Define missing tokens in `theme.ts` and use them.

---

### P1-18. Add TypeScript strict flags

**File:** `tsconfig.json`

Currently only `"strict": true`. Missing:
- `"noUncheckedIndexedAccess": true` — would catch `WEEKDAYS[i]` out-of-bounds
- `"exactOptionalPropertyTypes": true` — would force `matchedPhrase?: string` callers to distinguish omitted vs `undefined`
- `"noFallthroughCasesInSwitch": true`
- `"noImplicitOverride": true`

---

### P1-19. Web bundle CI gate has no threshold

**File:** `.github/workflows/ci.yml:80-85`

The size summary echoes to `$GITHUB_STEP_SUMMARY` but never fails. A 10x
regression ships unnoticed.

**Fix:** Parse bytes, compare against baseline (912KB current), fail on
`> 2x`.

---

### P1-20. Settings route `RootStackParamList.Settings: undefined` is a forward-compat slot

**File:** `src/nav/RootNav.tsx:37-41`

The Settings route is declared in the type union but never registered as a
`<Stack.Screen>`. Today, ProfileScreen shows an `Alert.alert` placeholder
for "Legal & safety" and "Export your data" — the audit noted this. Either
register a real `SettingsScreen.tsx` with mascot/tone/goals editors + privacy
+ export, or update the onboarding copy from "Change anytime in settings"
to "Change anytime by resetting and re-onboarding" (which is honest).

---

## P2 — Polish

### P2-1. `'rgba(42, 36, 56, 0.85)'` inline in CrisisModal

**File:** `src/components/CrisisModal.tsx:307`

Backdrop uses raw rgba literal, bypassing the theme contract. Add
`colors.scrim` or `colors.overlay` token.

---

### P2-2. `todayMood.score` shows raw number without context in TodayScreen eyebrow

**File:** `src/screens/TodayScreen.tsx:99-103`

The 5/6-day streak eyebrow uses raw numbers. For brand-new users the
display is unfriendly: "0-DAY STREAK" frames a new user as failing.

**Fix:** Show "START YOUR FIRST CHECK-IN" for `streak === 0`.

---

### P2-3. "Hey afternoon" copy

**File:** `src/screens/TodayScreen.tsx:19`

Awkward. Should be "Good afternoon."

---

### P2-4. `npm audit` / `osv-scanner` missing from CI

**File:** `.github/workflows/ci.yml`

881 packages, no audit gate.

**Fix:** Add `npm audit --omit=dev --audit-level=high` step.

---

### P2-5. `.nvmrc` / `engines` field missing

**File:** `package.json`

CI uses Node 20 but contributors on Node 18 see different `npm ci` behavior.

**Fix:** Add `"engines": { "node": ">=20.0.0" }` and `.nvmrc` with `20`.

---

### P2-6. `app.json:5` vs `package.json:3` version drift

(Already in P0-8.)

---

### P2-7. No `expo-updates` (OTA)

For a v0 alpha shipping weekly, native releases are slow.

**Fix:** Add `expo-updates`, configure `app.json:expo.updates.url`, set up EAS
Update channel.

---

### P2-8. No `CONTRIBUTING.md`, no `SECURITY.md`, no `CODE_OF_CONDUCT.md`

Standard repo-hygiene. `SECURITY.md` is critical for an app that handles
crisis-flagged text.

---

### P2-9. No `CODEOWNERS`

Safety-critical files (`src/safety/`, `src/components/CrisisModal.tsx`) should
be owned by a human, not an AI agent.

---

### P2-10. Test coverage is ~5%

`src/safety/crisis.ts` has 192 mjs cases; `src/storage.ts` has 21 vitest
cases; everything else is zero.

**Fix:** Set up vitest coverage, add threshold for `src/safety/` + `src/storage.ts`.

---

### P2-11. `eslint.config.js:106-109` disables `react/no-unstable-nested-components` repo-wide

**File:** `eslint.config.js:106-109`

This disables a real perf footgun (re-rendering nested functions on every
parent render). Should be narrowed to specific lines.

---

### P2-12. Vitest config bare-bones

**File:** `vitest.config.ts`

No `setupFiles`, no `globals: true`, no coverage block. Hand-rolled mocks
in `src/__tests__/storage.test.ts:14-45` should live in a shared setup file.

---

### P2-13. `mascot === 'bee'` shown 🐝 correctly but unknown mascot defaults to 🌙

Verified not a bug.

---

### P2-14. `app.json:5` microhone + speech permissions for code that doesn't exist

Already in P0-7.

---

### P2-15. `index.ts:1-8` no `enableScreens()` / `enableFreeze()`

Default behavior is fine for SDK 57. Not blocking.

---

### P2-16. `App.tsx:73-74` `boxShadow` string is web-only

Documented as web-only; iOS/Android ignore. Not blocking.

---

### P2-17. `ChatScreen.tsx:407-417` quick-pill touch targets < 44pt

13px text + 10px vertical padding produces a ~36-40pt control. Set
`minHeight: 44`.

---

### P2-18. `PracticeScreen.tsx:29-61` — 8 exercises shown but 7 are "Coming soon"

Visually disabled cards + a clear "Available now" feature of Box Breathing
would reduce disappointment.

---

### P2-19. `InsightsScreen.tsx:101-172` — chart has no y-axis labels

Users see movement but can't tell whether a point is 2/6 or 5/6.

---

### P2-20. `InsightsScreen.tsx:145-151` empty state has no CTA

Add a "Log today's mood" button.

---

### P2-21. `ProfileScreen.tsx:155-159` first-run stats show three zeroes

"0 / 0 / 0" looks evaluative immediately after onboarding. Defer stats
until first activity.

---

### P2-22. `RootNav.tsx:113-119` launch spinner is blank with no label

Add brand mark + "Loading your space" + a11y progress label.

---

## P3 — Backlog

- `spec/` and design system are out of sync with implementation (typography
  uses System font, not Inter)
- PracticeScreen promises "Or let Fernly suggest" but no recommendation
  appears
- CrisisModal cannot scroll on small screens (height not capped to viewport)
- mockReply deterministic on input — replace with real LLM when shipped
- `verifiedUrls` doesn't persist across sessions (P1-6)
- README path `cd ~/fernly-app` is wrong (actual repo is `~/repos/fernly`)
- "Export your data" doesn't export anything (P1-20)

---

## Cross-cutting observations

### What was confirmed by independent reviews

The 4 subagent reviews (code-quality, UX, DevOps, concurrency) independently
arrived at overlapping findings:
- Card a11y + storage reset race + crisis modal a11y — all caught in
  earlier audit cycles and shipped via 13 PRs.
- The **"alive" false positive** in crisis detector — caught by code-quality
  AND concurrency reviews.
- The **onboarding blank 6th step** — caught only by UX review.
- The **`warn` not `warnDeep` CTA** — caught by both UX and code-quality.
- The **stale-id write + isSending race** — caught by concurrency review
  with file:line evidence.
- The **lack of ErrorBoundary + Sentry** — caught by DevOps.

This independent convergence is a strong signal these issues are real.

### What's NOT in this audit that probably should be

- I did NOT re-run the full crisis detector corpus (`test-crisis-edge-cases.mjs`)
  against the current code with the new patterns. The 20 failing cases
  there are still failing — they're intentional specification gaps waiting
  for the detector to grow.
- I did NOT audit `data/exercises.ts` content for clinical claims (audit
  said "no embedded URLs, no claims of therapeutic efficacy beyond standard
  CBT/ACT framing" — passes a quick read but a clinical reviewer should
  confirm).
- I did NOT audit `src/safety/crisis.ts` for non-English-language false
  positives — only English was tested.

### What this audit didn't break

The 13 PRs shipped in this session (8 from the original audit + 5 UX-review
follow-ups) all merged cleanly, all gates green, all reviewed. The issues
above are NEW findings, not regressions on prior work. The codebase is in
better shape than it was yesterday.

---

## Recommended ship order

1. **P0-2** (onboarding blank step) — 5-line fix, no tests needed.
2. **P0-1** (crisis detector false positive) — tighten pattern + add CONTEXT_OVERRIDES entries; add 4-5 test cases.
3. **P0-3** (crisis CTA contrast) — 1-line style change, re-screenshot.
4. **P0-4** (isSending race) — refactor to useRef, add ChatScreen test.
5. **P0-5** (stale-id write) — move cancelled check, add ChatScreen test.
6. **P0-6** (ErrorBoundary) — wrap RootNav; minimum one test.
7. **P1-2** (holdTimerRef leak) — 2-line fix.
8. **P1-7** (box-breathing infinite loop) — track completedCycles, add completion state.
9. **P1-8** (reset disclosure) — update copy + add comment about retention.
10. **P1-14** (UTC date corruption) — shared helper + tests.
11. **P0-7** + **P0-8** (native build + release) — bigger process work, lower
    priority for a v0 alpha but ship-blocker for TestFlight.

Estimated: ~12-16 hours of focused work to close all P0s and ship-blocker
P1s. P2/P3 polish can land in follow-on weeks.
