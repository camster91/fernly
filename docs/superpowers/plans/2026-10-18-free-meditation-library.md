# Free Meditation Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Fernly's AI chat with a free, offline library of 12 guided audio sessions, a player, and progress stats.

**Architecture:** Session metadata is a pure TS catalog (testable in Node); audio `require()`s live in a separate map so vitest never loads binary assets. Playback uses `expo-audio` with background + lock-screen support. Completions are stored in AsyncStorage and summarized by pure helpers.

**Tech Stack:** Expo SDK 57, React Native 0.86, `expo-audio`, AsyncStorage, vitest 2, `tsx` for the dev-only audio generator.

**Spec:** `docs/superpowers/specs/2026-10-18-free-meditation-library-design.md`

## Global Constraints

- Free forever: no paywall, ads, account, analytics, or network calls added by this work.
- Read https://docs.expo.dev/versions/v57.0.0/ before writing Expo code (AGENTS.md). Install native deps with `npx expo install`.
- Audio files: `assets/audio/<id>.m4a`, AAC mono ~48 kbps. Scripts: `content/scripts/<id>.md`.
- Pause marker syntax: a line containing only `[pause Ns]` (N = integer seconds).
- Completion threshold: playback position ≥ 90 % of duration; recorded once per play-through.
- Completions key `@fernly/session-completions`, capped at 1,000 entries (newest kept).
- Copy is "wellness, not therapy"; no medical claims. Audience 18+.
- `npm run ci` green after every task.

## Review Focus

1. Leaving the Player mid-session → audio stops and lock-screen controls clear; no completion recorded.
2. Replaying a finished session → a second completion is recorded only after reaching 90 % again (not on mount, not on every status tick).
3. Streak across midnight in the user's local time zone → based on local calendar days, not UTC.
4. Corrupt or non-array completions in storage → treated as `[]`, app does not crash.
5. A session id in the catalog with no script or no audio file → caught by tests, not at runtime.

---

### Task 1: Remove the AI chat

**Files:**

- Delete: `src/screens/ChatScreen.tsx`, `src/api/chat.ts`, `src/__tests__/chat.api.test.ts`
- Modify: `src/nav/RootNav.tsx` (drop Chat tab + import; tab a11y labels "tab N of 4" until Task 7 adds Meditate)
- Modify: `src/components/CrisisModal.tsx` (remove deprecated `matchedPhrase` prop)
- Modify: `src/data/mascots.ts` header comment; `src/screens/SettingsScreen.tsx` `showLegal` copy (drop chat wording); any `EXPO_PUBLIC_CHAT_API_URL` mention (`grep -rn CHAT_API`)

**Interfaces:** Produces `CrisisModal` props `{ visible: boolean; locale?: string; onDismiss: () => void }`.

- [ ] **Step 1:** Delete the three files and remove all references (`grep -rn "ChatScreen\|api/chat\|fetchReply\|readChatBackendUrl\|CHAT_API" src App.tsx index.ts README.md`).
- [ ] **Step 2:** Keep chat storage functions and `src/safety/crisis.ts` untouched (privacy: export + Reset of old chats).
- [ ] **Step 3:** Run `npm run ci` → exit 0; no grep hits from Step 1.
- [ ] **Step 4:** Commit `refactor: remove AI chat (free, no running costs)`.

### Task 2: Session catalog, scripts, placeholder audio

**Files:**

- Create: `src/data/sessions.ts`, `src/data/sessionAudio.ts`, `content/scripts/<id>.md` ×12, `assets/audio/<id>.m4a` ×12 (placeholders)
- Test: `src/data/__tests__/sessions.test.ts`

**Interfaces — Produces:**

```ts
// src/data/sessions.ts  (no require() — safe in vitest)
export type SessionCategory = 'meditate' | 'sleep' | 'sos' | 'course';
export interface SessionDef {
  id: string; title: string; blurb: string; category: SessionCategory;
  durationSec: number; courseId?: 'basics'; courseOrder?: number;
}
export const sessions: SessionDef[];
export function sessionById(id: string): SessionDef | undefined;
export const CATEGORY_LABELS: Record<SessionCategory, string>; // Meditations, Sleep, SOS, Basics course

// src/data/sessionAudio.ts
export const sessionAudio: Record<string, number>; // id -> require('../../assets/audio/<id>.m4a')
```

Ids (exact): `calm`, `focus`, `stress-reset`, `gratitude` (meditate); `sleep-body-scan`, `sleep-breath-count`, `sleep-let-go` (sleep); `sos-panic`, `sos-anger`, `sos-overwhelm` (sos); `basics-1`, `basics-2` (course, `courseId: 'basics'`, `courseOrder` 1/2).

- [ ] **Step 1: Write failing tests** in `sessions.test.ts` (use `node:fs` + `node:path`):
  - `ids are unique and kebab-case` — `/^[a-z0-9-]+$/`
  - `has 12 sessions: 4 meditate, 3 sleep, 3 sos, 2 course`
  - `basics parts are ordered 1..2`
  - `every session has a script and every script has a session` — set equality of ids vs `content/scripts/*.md` basenames
  - `every session has an audio file` — `assets/audio/<id>.m4a` exists
  - `sessionAudio has exactly the catalog ids` — parse `src/data/sessionAudio.ts` text with `/'([a-z0-9-]+)':\s*require\('..\/..\/assets\/audio\/\1\.m4a'\)/g` (don't import it)
  - `durationSec is positive` and `sos sessions are ≤ 180s`
- [ ] **Step 2:** `npx vitest run src/data/__tests__/sessions.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Write the catalog, the audio map, and 12 scripts per spec §2 (meditate 5–10 min, sleep 10–15 min, sos 2–3 min, basics 5 min of spoken text + pauses; plain adult language; no medical claims). Set `durationSec` to the intended length; Task 5 replaces with real values.
- [ ] **Step 4:** Create placeholder audio: `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 2 -c:a aac -b:a 48k assets/audio/<id>.m4a` for each id. If ffmpeg is unavailable, generate one file elsewhere and copy it 12×.
- [ ] **Step 5:** Re-run the test → PASS; `npm run ci` → exit 0.
- [ ] **Step 6:** Commit `feat: session catalog, scripts, placeholder audio`.

### Task 3: Progress helpers

**Files:** Create `src/util/progress.ts`; Test `src/util/__tests__/progress.test.ts`

**Interfaces — Produces:**

```ts
export interface SessionCompletion { sessionId: string; completedAt: string; seconds: number }
export function totalMinutes(c: SessionCompletion[]): number;          // floor(sum(seconds)/60)
export function sessionsCompleted(c: SessionCompletion[]): number;      // c.length
export function currentStreak(c: SessionCompletion[], today: Date): number;
export function isComplete(positionSec: number, durationSec: number): boolean; // duration>0 && position >= 0.9*duration
```

`currentStreak`: distinct local `YYYY-MM-DD` days (reuse `src/util/date.ts` helpers if they produce local day keys); count consecutive days back from today, or from yesterday if today has none; 0 otherwise.

- [ ] **Step 1: Failing tests:** empty → 0/0/0; 90 s + 45 s → 2 minutes; streak today+yesterday = 2; only yesterday = 1; gap of a day = counts only the recent run; two completions same day count once; completion at 23:30 local and 00:30 local next day = 2 (set `process.env.TZ` as `date.test.ts` does); `isComplete(89, 100)` false, `(90, 100)` true, `(5, 0)` false.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: progress helpers (minutes, count, streak)`.

### Task 4: Store completions

**Files:** Modify `src/storage.ts`, `src/screens/SettingsScreen.tsx` (export); Test `src/__tests__/storage.test.ts`

**Interfaces:** Consumes `SessionCompletion` (Task 3). Produces `storage.getCompletions(): Promise<SessionCompletion[]>`, `storage.addCompletion(c: SessionCompletion): Promise<void>`.

- [ ] **Step 1: Failing tests:** add then get returns it (newest first); cap keeps newest 1,000 of 1,001; non-array JSON at the key → `[]`; `clearAll()` removes the key; key is `@fernly/session-completions`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Add `completions` to `ASYNC_KEYS` (so `clearAll` wipes it) and the two methods (validate array on read). **Step 4:** Run → PASS.
- [ ] **Step 5:** Add `completions` to the Settings export JSON.
- [ ] **Step 6:** `npm run ci` → exit 0. Commit `feat: persist session completions`.

### Task 5: Audio generator (dev-only)

**Files:** Create `scripts/generate-audio.ts`, `scripts/parse-script.ts`, `scripts/__tests__/parse-script.test.ts`; Modify `vitest.config.ts` include to add `'scripts/**/*.test.ts'`; `README.md` short "Generating audio" section.

**Interfaces — Produces:**

```ts
// scripts/parse-script.ts
export type ScriptPart = { kind: 'speech'; text: string } | { kind: 'pause'; seconds: number };
export function parseScript(md: string): ScriptPart[];
```

`generate-audio.ts`: for each `content/scripts/*.md` → `parseScript` → speech parts to OpenAI `POST https://api.openai.com/v1/audio/speech` (model `gpt-4o-mini-tts` unless the docs show a newer default, a calm voice, `response_format: 'wav'`) using `OPENAI_API_KEY`; pauses via ffmpeg `anullsrc`; concat; encode `-ac 1 -c:a aac -b:a 48k` to `assets/audio/<id>.m4a`; print `id durationSec` (ffprobe). Exit non-zero with a clear message if the key or ffmpeg is missing. Provider call isolated in one function `synthesize(text: string): Promise<Buffer>`.

- [ ] **Step 1: Failing tests:** text-only → one speech part; `[pause 10s]` line → pause 10; adjacent text lines merge into one speech part with paragraph breaks kept; blank lines and leading/trailing whitespace ignored; `[pause 0s]` or malformed `[pause x]` throws an `Error` naming the line number.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement parser + generator. **Step 4:** Run → PASS; `npx tsc --noEmit` passes (add `scripts` to tsconfig include if needed).
- [ ] **Step 5:** Commit `feat: one-time TTS audio generator`.

### Task 6: Player screen

**Files:** Create `src/screens/PlayerScreen.tsx`; Modify `app.json` (plugin `["expo-audio", { "enableBackgroundPlayback": true }]`), `App.tsx` (call `setAudioModeAsync` once on mount), `src/nav/RootNav.tsx` (stack screen `Player`, param `{ sessionId: string }`), `package.json` via `npx expo install expo-audio`.

**Interfaces:** Consumes `sessionById`, `sessionAudio`, `isComplete`, `storage.addCompletion`. Produces route `Player` with params `{ sessionId: string }`.

- [ ] **Step 1:** Read the SDK 57 `expo-audio` page; confirm `useAudioPlayer`, `useAudioPlayerStatus`, `setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' })`, `setActiveForLockScreen(true, { title, artist: 'Fernly' })`, `clearLockScreenControls()`.
- [ ] **Step 2:** Build the screen: title, blurb, play/pause, back 15 s (`seekTo(max(0, t-15))`), progress bar + `m:ss` elapsed/remaining. Unknown `sessionId` → message + back button.
- [ ] **Step 3:** Completion: a ref `recordedForThisPlay`; when `isComplete(status.currentTime, status.duration)` and not recorded → `addCompletion({ sessionId, completedAt: new Date().toISOString(), seconds: Math.round(status.duration) })`, set ref. Reset ref when the user restarts from < 10 % (replay).
- [ ] **Step 4:** On unmount: `player.pause()`, `clearLockScreenControls()`.
- [ ] **Step 5:** `npm run ci` → exit 0; `npx expo export --platform web --output-dir /tmp/fernly-web` builds. Commit `feat: audio player with background + lock screen`.

### Task 7: Meditate tab + Today card

**Files:** Create `src/screens/MeditateScreen.tsx`; Modify `src/nav/RootNav.tsx` (tab order Today · Meditate · Practice · Insights · You; a11y "tab N of 5"; glyph `🎧`), `src/screens/TodayScreen.tsx`.

**Interfaces:** Consumes `sessions`, `CATEGORY_LABELS`, route `Player`. Produces `pickTodaySession(date: Date): SessionDef` in `src/data/sessions.ts` (rotates through `category === 'meditate'` by local day-of-year).

- [ ] **Step 1: Failing test** in `sessions.test.ts`: `pickTodaySession` returns a meditate session; same date → same session; consecutive days → different sessions.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** MeditateScreen: sections in order Meditations, Sleep, SOS, Basics course (sorted by `courseOrder`); each row title · blurb · `N min`; tap → `Player`. Today: one "Today's session" card using `pickTodaySession(new Date())`.
- [ ] **Step 6:** `npm run ci` → exit 0. Commit `feat: Meditate tab and today's session`.

### Task 8: "Need help now?" on every tab

**Files:** Create `src/components/HelpButton.tsx`; Modify `src/components/ScreenContainer.tsx` (optional prop `showHelp?: boolean`, default `true`, renders `HelpButton` top-right), pass `showHelp={false}` from Player, Settings, Exercise, MoodCheckIn, Onboarding.

**Interfaces:** Consumes `CrisisModal` (Task 1). `HelpButton` owns `useState` visibility and renders `<CrisisModal visible onDismiss />`.

- [ ] **Step 1:** Implement; label "Need help now?", `accessibilityRole="button"`, hint "Opens crisis helplines", min 44×44 touch target.
- [ ] **Step 2:** `npm run ci` → exit 0. Manually confirm in web export that each of the 5 tabs shows it.
- [ ] **Step 3:** Commit `feat: crisis help button on every tab`.

### Task 9: Insights stats, onboarding 18+, free-forever copy

**Files:** Modify `src/screens/InsightsScreen.tsx`, `src/screens/OnboardingScreen.tsx`, `src/screens/ProfileScreen.tsx`.

**Interfaces:** Consumes `storage.getCompletions`, `totalMinutes`, `sessionsCompleted`, `currentStreak`.

- [ ] **Step 1:** Insights: three stat tiles above the mood view — "Minutes", "Sessions", "Day streak" — loaded with `useFocusEffect`.
- [ ] **Step 2:** Onboarding: new first step "Before we start" with text "Fernly is free forever. No ads. No account." and a required checkbox "I'm 18 or older"; Next disabled until checked; eyebrows become "STEP N OF 6".
- [ ] **Step 3:** Profile: line "Free forever · no ads · no account".
- [ ] **Step 4:** `npm run ci` → exit 0. Commit `feat: progress stats, 18+ gate, free-forever copy`.

### Task 10: Final verification

- [ ] `rm -rf node_modules && npm ci && npm run ci` → exit 0.
- [ ] `npx expo export --platform web --output-dir /tmp/fernly-web` succeeds.
- [ ] Spec §8 manual device checks listed in the PR body as owner to-dos (can't run in CI).
- [ ] Push; open PR; subscribe.
