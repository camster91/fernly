# Fernly

> A wellness companion for Gen Z. Mobile-first, hybrid text + voice, mixed CBT/ACT. Soft pastel design system + a working v0 Expo app.

**Status:** v0 alpha — built 2026-07-10 in one evening. Crisis detection shipped. Real LLM chat, voice, and App Store submission are next.

---

## What's in this repo

| Path | What it is |
|---|---|
| `App.tsx`, `src/` | The working Expo app (SDK 57, React Native 0.86, React 19.2) |
| `spec/index.html` | Design system + 30 screen mocks + 4 brand mark explorations. Open in a browser. |
| `spec/build/*.png` | Screenshots of the live v0 on a phone-sized viewport |
| `plans/01-product-plan.md` | The product plan: positioning, stack, 8-week arc, risks |
| `plans/02-naming-decision.md` | How we landed on Fernly (Tide → Olio → Fernly) |

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

## What's shipped (v0)

- [x] **Onboarding** — 5 steps, real validation, persists profile
- [x] **Today** — greeting, streak strip, 3 context cards
- [x] **Mood check-in** — 6-emoji picker, quick-word tags, persisted to AsyncStorage
- [x] **Chat** — empty state, deterministic tone-aware mock replies, mic button toggle
- [x] **Practice** — 8 exercises listed, box breathing fully built (live 4-4-4-4 cycle)
- [x] **Insights** — real SVG line chart from mood data, average stat
- [x] **Profile** — mascot avatar, stats, 6 settings rows
- [x] **Crisis detection** — keyword + soft-signal detector, always-wins modal, 18/18 unit cases pass

## What's NOT shipped yet

- [ ] Real LLM chat (FastAPI + GPT-4o-mini) — currently deterministic mock
- [ ] Voice mode (Hailuo STT → text → ElevenLabs TTS playback)
- [ ] 7 of 8 exercises (only box breathing is built; others are stubs)
- [ ] Auth (anyone with the URL can use the web build)
- [ ] App Store submission (TestFlight alpha target: ~5 weeks from initial build)

---

## Design system

Soft pastel palette. Lavender as primary accent, peach/yellow/mint/rose as accent backgrounds. Inter + Nunito (system fallback in v0). All tokens defined in `src/theme.ts` and mirrored in `spec/index.html`.

| Token | Hex | Use |
|---|---|---|
| `lavender500` | `#9B7DD4` | Primary accent · buttons, links, key states |
| `peach500` | `#F5895A` | Warm accent, streak celebration |
| `mint300` | `#8FDDB4` | Success, completed states |
| `rose500` | `#E55D75` | Warnings, crisis, recording |
| `ink` | `#2A2438` | Primary text |
| `paper` | `#FBF9F6` | App background · warm, never pure white |

---

## The brand mark

The fern frond SVG lives in `src/components/BrandMark.tsx`. **It's currently a placeholder geometry** — production-ready mark needs a real designer. See `spec/index.html` section 01.5 for the full exploration (4 AI-rendered concepts + designer brief).

---

## Safety

Crisis detection runs on every user message before the LLM. If a hard pattern matches (e.g. "I want to kill myself", "don't want to be alive"), a modal appears with hotline resources and **the LLM never sees the message**. The detector is at `src/safety/crisis.ts` and has a soft-signal layer that logs patterns without blocking.

The plan still flags a **clinical advisor** as the highest-risk deferred decision. Crisis detection is a real safety net but not a substitute for a licensed psychologist reviewing prompts.

---

## Repo conventions

- `main` branch is the source of truth. No long-lived feature branches yet.
- Source files: TypeScript, organized under `src/` by concern (`screens/`, `components/`, `data/`, `safety/`, `nav/`, `theme.ts`).
- No tests yet. Crisis detector has an inline 18-case smoke test; that should grow.
- Don't commit `node_modules/` (already in `.gitignore`).

---

## Plan & context

This project started as a Telegram conversation. The full plan (`plans/01-product-plan.md`) and naming decision (`plans/02-naming-decision.md`) are in this repo. The original spec with 30 screen mocks and brand mark exploration is `spec/index.html` — open it in a browser.

If you're picking this up fresh, the **single most important read** is `plans/01-product-plan.md`. It tells you what we're building, why, and the 8-week arc from v0 to TestFlight alpha.

---

## License

Private — not yet licensed. All rights reserved until open-source decision is made.