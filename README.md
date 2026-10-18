# Fernly

> A free, offline guided-meditation app. Mobile-first Expo app with a soft pastel design system.

**Status:** v0 alpha. Free forever, no ads, no account. Everything stays on your device.

---

## What's in this repo

| Path                          | What it is                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `App.tsx`, `src/`             | The working Expo app (SDK 57, React Native 0.86, React 19.2)                    |
| `spec/index.html`             | Design system + 30 screen mocks + 4 brand mark explorations. Open in a browser. |
| `spec/build/*.png`            | Screenshots of the live v0 on a phone-sized viewport                            |
| `plans/01-product-plan.md`    | The product plan: positioning, stack, 8-week arc, risks                         |
| `plans/02-naming-decision.md` | How we landed on Fernly (Tide → Olio → Fernly)                                  |

---

## Running the app

```bash
cd ~/fernly-app
npm install
npx expo start --web --port 8084
# Opens at http://localhost:8084
```

For an iOS simulator (after switching Xcode path with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`):

```bash
npx expo start --ios
```

---

## What's in the app

- [x] **Onboarding** — 18+ confirmation, name, mood, goals, mascot
- [x] **Meditate** — guided sessions with offline audio, today's session, and a Player
- [x] **Mood check-ins** — 6-emoji picker and quick-word tags, saved on device
- [x] **Exercises** — breathing and other short practices
- [x] **Insights** — minutes meditated, sessions completed, day streak, and a weekly mood chart
- [x] **Crisis helplines** — a help button on every tab, always one tap away
- [x] **Everything on device** — no account, no ads, free forever

## Not yet

- [ ] Real narration (the shipped audio files are silent placeholders; see "Generating audio")
- [ ] App Store submission

---

## Design system

Soft pastel palette. Lavender as primary accent, peach/yellow/mint/rose as accent backgrounds. Inter + Nunito (system fallback in v0). All tokens defined in `src/theme.ts` and mirrored in `spec/index.html`.

| Token         | Hex       | Use                                         |
| ------------- | --------- | ------------------------------------------- |
| `lavender500` | `#9B7DD4` | Primary accent · buttons, links, key states |
| `peach500`    | `#F5895A` | Warm accent, streak celebration             |
| `mint300`     | `#8FDDB4` | Success, completed states                   |
| `rose500`     | `#E55D75` | Warnings, crisis, recording                 |
| `ink`         | `#2A2438` | Primary text                                |
| `paper`       | `#FBF9F6` | App background · warm, never pure white     |

---

## The brand mark

The fern frond SVG lives in `src/components/BrandMark.tsx`. **It's currently a placeholder geometry** — production-ready mark needs a real designer. See `spec/index.html` section 01.5 for the full exploration (4 AI-rendered concepts + designer brief).

---

## Safety

Fernly is not a substitute for professional care. A help button on every tab opens a list of crisis helplines by country, always one tap away. The helpline data lives in `src/safety/crisis.ts`.

## Privacy & storage

Fernly is free forever, with no ads and no account. There is no backend: everything is stored on your device.

- **AsyncStorage (unencrypted, OS-level):** profile, mood entries, onboarding complete flag, exercise sessions, and meditation completions.
- **`expo-secure-store` (encrypted, device-unlock-gated):** the crisis-pattern audit log, which intentionally survives Profile → Reset. Any chat history left over from earlier versions also lives here and is deleted by Reset.

**Web:** `expo-secure-store` on web falls back to `localStorage` with no OS-level encryption. Web is appropriate for self-hosted / preview deploys, not for storing private data on a shared device.

---

## Generating audio

The shipped `assets/audio/*.m4a` files are silent placeholders. To replace them with real narration (run once, on your own machine; dev-only, not part of the app):

1. Review the scripts in `content/scripts/*.md` first. A pause is a line containing only `[pause Ns]`.
2. Install `ffmpeg` (includes `ffprobe`) and set `OPENAI_API_KEY`.
3. Run `npx tsx scripts/generate-audio.ts` (or pass one session id to regenerate just that one).
4. The script prints `id durationSec` per session; copy those values into `durationSec` in `src/data/sessions.ts`.
5. Verify with `npx tsx scripts/check-audio.ts`. It fails if any file is still a placeholder (under 20 KB) or missing. The release workflow runs it before building; `npm run ci` does not, so placeholders still pass normal CI.

---

## Repo conventions

- `main` branch is the source of truth. No long-lived feature branches yet.
- Source files: TypeScript, organized under `src/` by concern (`screens/`, `components/`, `data/`, `safety/`, `nav/`, `theme.ts`).
- Tests use vitest (`npm test`); `npm run ci` runs typecheck, lint, format check, and tests.
- Don't commit `node_modules/` (already in `.gitignore`).

---

## Plan & context

This project started as a Telegram conversation. The full plan (`plans/01-product-plan.md`) and naming decision (`plans/02-naming-decision.md`) are in this repo. The original spec with 30 screen mocks and brand mark exploration is `spec/index.html` — open it in a browser.

If you're picking this up fresh, the **single most important read** is `plans/01-product-plan.md`. It tells you what we're building, why, and the 8-week arc from v0 to TestFlight alpha.

---

## License

Private — not yet licensed. All rights reserved until open-source decision is made.
