# Fernly — AI Wellness Companion
# Fernly — AI Wellness Companion

**Brand name:** Fernly (locked 2026-07-10 — chosen from 4-name invented shortlist)
**Created:** 2026-07-10
**Mode:** Side project, 10–20 hrs/week, in parallel with curator-redesign
**Budget:** Self-funded, $500–800/mo runway

---

## One-line positioning

> For Gen Z who won't book a therapist. Fernly is a private companion in your pocket for the small stuff — daily check-ins, CBT/ACT exercises, and a calm voice when things feel too loud.

**Not:** therapy. Clinical care. Crisis support.
**Is:** wellness companion. Between-session support. Skills practice.

---

## Decisions locked

| Fork | Choice | Why |
|---|---|---|
| Lane | Wellness companion (Wysa/Woebot-style) | Lowest regulatory burden, fastest to ship |
| ICP | Gen Z / young millennial | Clear aesthetic lane, mobile-first, social-native |
| Surface | Expo → App Store + Play Store | Real app, real revenue, but 2–3 weeks of submission friction |
| Modal | Hybrid (text default, voice button) | Best retention, deferred voice to week 4 |
| Personality | Mixed CBT + ACT | Wider audience, exercises from both libraries |
| Visual | Soft pastel — lavender, peach, yellow | Calm, safe, Earkick-style |
| Monetization | Free (3 chats/day) · $4.99/mo · $19.99/yr | Low price maximizes conversion; standard Wysa-tier |
| Clinical advisor | **None** | Flagged as the highest-risk decision in this plan |

---

## Surface scope — v0

### In
- 7-question onboarding + personality selection + mascot picker
- Daily check-in (morning + evening prompts)
- Chat with persistent memory (per-user summary vector)
- Voice button (Hailuo STT → text chat → MiniMax/ElevenLabs TTS)
- 8–10 modular exercises:
  1. Thought record (CBT)
  2. Cognitive reframe (CBT)
  3. ACT defusion ("I'm having the thought that…")
  4. Values card sort (ACT)
  5. 5-4-3-2-1 grounding
  6. Box breathing (4-4-4-4)
  7. Two truths and a lie (reframes)
  8. Bedtime body scan
  9. Worry postponement (CBT)
  10. Self-compassion break
- Mood graph + weekly insights ("Mondays are harder")
- Crisis safety net (keyword + classifier → hotline redirect, never AI response)
- Freemium gate (3 chats/day free)
- Push notifications (1/day max, opt-in, never guilt-trip)
- Streaks (gentle, never punishing)

### Out (deferred)
- HIPAA infrastructure (only if B2B or PHI later)
- Video avatar / 3D presence (Soul Machines or HeyGen API in v1)
- Group/community features (moderation cost too high pre-PMF)
- B2B2C / employer sales (different sales motion, 6-month cycle)
- Wearable integration (nice-to-have)
- Custom LLM training (until 10k MAU + real eval set)
- Couples/family mode (different ICP)
- Web companion (PWA later if mobile app proves out)

---

## Tech stack

| Layer | Choice | Cost (1k MAU) |
|---|---|---|
| App | Expo (React Native) + EAS OTA | EAS free tier |
| Backend | FastAPI on Fly.io | ~$30 |
| DB | Postgres (Supabase or Neon) + pgvector | $25 |
| LLM | GPT-4o-mini primary, Claude Haiku fallback | ~$50 |
| STT | OpenAI Whisper / Hailuo STT | ~$20 |
| TTS | ElevenLabs (Pro voice) or MiniMax | ~$40 |
| Auth | Clerk | $25 (Pro tier) |
| Payments | RevenueCat | Free under $2.5k MTR |
| Analytics | PostHog (cloud) + Mixpanel AMP | Free tier |
| Crash | Sentry | Free tier |
| Crisis detection | Keyword regex + secondary LLM classifier | negligible |

**Estimated total at 1k MAU:** ~$190/mo
**Estimated total at 10k MAU (5% paid):** ~$700/mo
**Gross rev at 5% × 10k × $4.99:** ~$2.5k/mo
**Net:** still in investment mode at 10k MAU — need 30k+ MAU for real margin

---

## 8-week build arc (realistic calendar: 10–11 weeks)

| Week | Focus | Output |
|---|---|---|
| 1 | Brand + design system + 30 screen mocks | Figma (or HTML spec), positioning doc |
| 2 | Expo scaffold + auth + onboarding + daily check-in | Internal build, TestFlight alpha |
| 3 | Chat surface + memory + LLM orchestration + crisis detector | Working conversation, internal only |
| 4 | Exercise library (8–10 tools) + mood graph + analytics | Working exercises |
| 5 | Voice button + STT/TTS wiring + Pro paywall (RevenueCat) | Hybrid surface live |
| 6 | Beta (50 users from network) + bug hunt + copy polish | TestFlight, real feedback |
| 7 | App Store prep (screenshots, EULA, privacy, clinical disclaimer) | Submission ready |
| 8 | Submit to App Store + Play Store | In review |
| 9–10 | Buffer for rejections (~2 cycles expected for wellness apps) | Live on store |
| 11 | Soft launch in 1 English-speaking country, 100 users | Public v0 |

**Reality check:** the 8-week arc assumes no rejections on first submission, which is unrealistic. Treat weeks 1–7 as build, weeks 8–11 as App Store gauntlet.

---

## Risks (ranked by likelihood × impact)

### 1. **Retention cliff** (HIGH likelihood, MEDIUM impact)
- Day-30 retention in wellness category: 15–30%
- Mitigation: smart push notifications, weekly insight emails, exercise variety
- Owner: PM (Cam) reviews weekly cohort retention

### 2. **Clinical / liability incident** (MEDIUM likelihood, CRITICAL impact)
- One Reddit thread about a bad outcome = feature in WaPo = class-action inquiry
- Mitigation in v0 (without advisor):
  - Hard-coded crisis detection with mandatory hotline redirect
  - Disclaimer on every chat: "I'm not a therapist. If you're in crisis, call 988."
  - EULA explicitly limits liability
  - Session transcripts human-reviewable by Cam
- Mitigation deferred to v1: clinical advisor (~$400/mo), HIPAA infra
- **Honest assessment:** this is the riskiest decision in the plan

### 3. **App Store rejection** (HIGH likelihood, LOW impact)
- First submission: 60–70% reject rate for new wellness apps
- Common reasons: medical claims, missing privacy nutrition labels, vague screenshots
- Mitigation: spend week 7 on submission prep; budget 2 weeks for rejections

### 4. **LLM cost overrun** (MEDIUM likelihood, MEDIUM impact)
- Heavy users can hit $0.50/day in LLM calls
- Mitigation: 3 chat/day free limit, GPT-4o-mini (not GPT-4o) for casual chat, Claude Haiku for empathetic prompts
- Future: per-user cost telemetry, dynamic model selection

### 5. **Slow organic growth** (HIGH likelihood, MEDIUM impact)
- Wellness apps have ~$40–80 CAC on paid social; Gen Z is burned out on ads
- Mitigation: TikTok-native content (the actual companion doing the exercises), Gen Z influencer seeding (5–10 micro-creators, product not payment), referral mechanic

### 6. **Competitive feature parity** (HIGH likelihood, LOW impact)
- Wysa, Woebot, Earkick, Finch, Slingshot all exist
- Mitigation: personality > features. Fernly wins on *voice* (personality + vibe), not on exercise count.

---

## Success metrics (90-day post-launch)

| Metric | Target | Source of truth |
|---|---|---|
| Downloads | 2,000 | App Store Connect |
| DAU/MAU ratio | 25%+ (wellness category benchmark) | PostHog |
| Day-30 retention | 20%+ | PostHog cohort |
| Free → Pro conversion | 3–5% | RevenueCat |
| ARPU | $0.20+ (blended) | RevenueCat |
| Negative incident reports | 0 | Manual review |
| Avg sessions / user / week | 4+ | PostHog |

If we hit these at 90 days, v1 (clinical advisor, HIPAA infra, group features) becomes a real conversation.

---

## Open questions / next decisions

1. **Mascot** — illustrated plant mark? abstract shape? text-only?
2. **Launch country** — US only, or include UK/CA for Samaritans / Talk Suicide Canada coverage?
3. **App Store name** — "Fernly: Daily Check-in" or "Fernly — Calm Companion"?
4. **Open-source** — does the app have a community? GitHub repo for the exercise library?

---

## What this plan is NOT

- Not a clinical product. Not therapy. Not a replacement for human care.
- Not a "build it and they'll come" play. Retention is the product.
- Not a quick flip. Wellness apps that work take 18–24 months to find PMF.

---

## Deliverables for this session

1. `/Users/biancabienaime/.hermes/plans/2026-07-10_fernly-ai-therapist.md` — this file
2. `/Users/biancabienaime/fernly-spec/index.html` — design system + 30 screen mocks
3. `/Users/biancabienaime/fernly-spec/screens/*.png` — exported screen mocks

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-10 | Wellness companion lane | Lowest regulatory burden, fastest ship |
| 2026-07-10 | Gen Z ICP | Clear aesthetic, mobile-native, large addressable market |
| 2026-07-10 | Expo → App Store + Play Store | Real app, real revenue |
| 2026-07-10 | Hybrid text+voice | Best retention, voice deferred to week 4 |
| 2026-07-10 | Mixed CBT + ACT | Wider audience |
| 2026-07-10 | Soft pastel design | Calm, safe, Earkick-style |
| 2026-07-10 | $4.99/mo · $19.99/yr | Low price maximizes Gen Z conversion |
| 2026-07-10 | Self-funded | Bootstrapped, slow, in control |
| 2026-07-10 | **No clinical advisor** | Flagged as highest-risk decision |
| 2026-07-10 | "Fernly" locked | Chosen from Olio/Fernly/Halcy/Softly shortlist after Olio rejected for brand collision with Olio food-sharing app (10M+ users) |