# Fernly: free guided-meditation library — design

Date: 2026-10-18 · Status: awaiting owner review

## Goal

Turn Fernly into a free Headspace-style app. **Free forever: no paywall,
no ads, no account.** The edge over Headspace is price, not feature count.

## Decisions (from the owner)

| Topic          | Decision                                                        |
| -------------- | --------------------------------------------------------------- |
| Positioning    | Free forever, no paywall / ads / account                        |
| Audio source   | AI text-to-speech, generated once, shipped in the app           |
| AI chat        | Removed (ongoing cost + legal risk)                             |
| Launch library | ~12 sessions                                                    |
| Delivery       | Audio bundled in the app binary (~25–30 MB); offline; no server |

## Assumptions (not stated by the owner — confirmed by silence)

- Stays Expo SDK 57 / React Native; keeps the Fernly name and visual style.
- Private: all data stays on the device.
- Audience 18+ for now.

## Non-goals

- Accounts, sync, payments, ads, analytics.
- Downloadable / server-hosted content.
- Courses longer than the 2-part Basics.
- New free-text features (journal) — out of scope for this change.

## 1. Navigation

Tabs: **Today · Meditate · Practice · Insights · You**. Chat tab removed.

- A **"Need help now?"** button in the header of every tab opens the
  existing `CrisisModal` (manual open; same helplines). Because it is only
  user-opened, the modal now has a plain Close button (and Android back)
  instead of the long-press dismiss.
- New stack screen **Player** (pushed from Meditate or Today).

## 2. Content

### Catalog — `src/data/sessions.ts`

```ts
type SessionCategory = 'meditate' | 'sleep' | 'sos' | 'course';
interface SessionDef {
  id: string; // stable, kebab-case; used in progress storage
  title: string;
  blurb: string; // one line for the list
  category: SessionCategory;
  durationSec: number; // matches the audio file (checked by a test)
  audio: number; // require('../../assets/audio/<id>.m4a')
  courseId?: 'basics';
  courseOrder?: number; // 1, 2
}
```

### Launch list (12)

- Meditate (4): calm, focus, stress-reset, gratitude — 5–10 min each.
- Sleep (3): body-scan wind-down, breath-counting, "let the day go" — 10–15 min.
- SOS (3): panic, anger, overwhelm — 2–3 min.
- Course "Basics" (2): part 1 "What meditation is", part 2 "Noticing the breath" — 5 min.

### Scripts — `content/scripts/<id>.md`

Plain text the narrator reads, with pause markers on their own line:
`[pause 10s]`. Scripts are written for adults, plain language, no medical
claims ("wellness, not therapy").

## 3. Audio generation (one-time, owner's machine)

`scripts/generate-audio.ts` (dev-only, not shipped, run with `tsx`):

1. Reads every `content/scripts/*.md`.
2. Splits on `[pause Ns]`; sends each text chunk to a TTS API.
3. Joins chunks with N seconds of silence (ffmpeg).
4. Encodes AAC mono ~48 kbps → `assets/audio/<id>.m4a`.
5. Prints each file's duration so `sessions.ts` can be updated.

- Provider: OpenAI TTS by default (key in `OPENAI_API_KEY`, never
  committed); provider is one small function so ElevenLabs can be swapped in.
- Expected one-time cost: a few dollars for ~70 minutes of audio.
- Generated `.m4a` files are committed. Scripts are the source of truth.
- Until the owner runs it, a short silent placeholder per session lets
  the app build and tests run.

## 4. Player — `src/screens/PlayerScreen.tsx`

Uses `expo-audio` (per SDK 57 docs):

- `useAudioPlayer(session.audio)`, `useAudioPlayerStatus(player)`.
- At app start: `setAudioModeAsync({ playsInSilentMode: true,
shouldPlayInBackground: true, interruptionMode: 'doNotMix' })`.
- `player.setActiveForLockScreen(true, { title, artist: 'Fernly' })` on
  play; `clearLockScreenControls()` on leave. (Required on Android or
  background playback stops after ~3 min.)
- `expo-audio` config plugin in `app.json` with `enableBackgroundPlayback: true`.
- Controls: play/pause, back 15 s, progress bar with elapsed/remaining.
- **Completion** = playback reaches ≥ 90 % of duration. Recorded once per
  play-through.

## 5. Progress — storage + Insights

AsyncStorage key `@fernly/session-completions`:
`{ sessionId, completedAt (ISO), seconds }[]`, capped at 1,000 entries.

Pure helpers in `src/util/progress.ts`:

- `totalMinutes(completions)`
- `sessionsCompleted(completions)`
- `currentStreak(completions, today)` — consecutive local days with ≥ 1
  completion, ending today or yesterday.

Insights shows these three stats above the existing mood view.
`clearAll()` and data export include completions.

## 6. Removing the chat

Delete: `src/screens/ChatScreen.tsx`, `src/api/chat.ts`,
`src/__tests__/chat.api.test.ts`, the Chat tab, `EXPO_PUBLIC_CHAT_API_URL`
mentions.

Keep:

- Chat **storage** functions, so existing users' chats are still
  exported and deleted by Reset (privacy). No new chat writes happen.
- `src/safety/crisis.ts` detector + its tests. With chat gone, nothing
  calls `detectCrisis` today; it stays for any future free-text feature.
  `crisisResourcesFor` keeps powering the modal.
- `CrisisModal` (drop the deprecated `matchedPhrase` prop).

## 7. Small changes

- Onboarding: one screen confirming "I'm 18 or older" (required to
  continue) and stating "Free forever. No ads. No account."
- You tab: "Free forever" line; remove chat-related settings/copy.
- `showLegal` text: drop chat wording.

## 8. Testing

Unit (vitest):

- Catalog integrity: unique ids; every category non-empty; Basics parts
  ordered 1..2; every `content/scripts/<id>.md` exists for each session
  and vice versa; every `assets/audio/<id>.m4a` exists.
- `progress.ts`: minutes, count, streak (gaps, today vs yesterday,
  timezone day boundary, empty).
- Completion threshold logic (pure function).
- Storage: completions persist, cap at 1,000, cleared by Reset, included
  in export.

Manual (device): play in silent mode, lock screen controls, background

> 3 min on Android, completion recorded, crisis button on every tab.

`npm run ci` must stay green.

## Owner actions

1. Create an OpenAI (or ElevenLabs) API key; run
   `OPENAI_API_KEY=… npx tsx scripts/generate-audio.ts` once; commit the
   audio.
2. Review the 12 scripts before generating audio.
3. Re-enable the CI workflow in GitHub Actions.
