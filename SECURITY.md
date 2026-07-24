# Security Policy — Fernly

## About this app

Fernly is a wellness companion for Gen Z — a hybrid text + voice app built on Expo SDK 57 (React Native). It handles sensitive content: mood logs, chat conversations, and a crisis-pattern detector that surfaces safety resources when users type indicators of self-harm.

Because we process crisis-flagged text, **security reports get routed straight to a human, never auto-triaged.** A missed report is worse than a slow response.

## Supported versions

| Version          | Supported                |
| ---------------- | ------------------------ |
| Latest on `main` | ✅ Active security fixes |
| Older releases   | ❌ No backports          |

This is a v0 alpha. We ship weekly; every release on `main` is the supported version. Older builds were never in anyone's hands and don't deserve backports.

## Reporting a vulnerability

**Email:** `security@fernly.app`

(Reach the owner directly if the alias fails — see Commit history in git log.)

**Please include:**

- A clear, reproducible description of the issue
- Steps to reproduce or a PoC exploit
- The platform (iOS / Android / web / all) where you observed it
- Your assessment of severity (crisis-path? data-leak? RCE?)
- Whether you'd like public credit when we ship the fix

**Don't post security issues to GitHub Issues.** Issues are public; vulnerability details should never be.

**Expected response time:**

- 24-hour acknowledgement
- 72-hour initial triage
- Severity + fix ETA at triage; usually a fix within 7 days for critical

## What counts as a critical issue

- CrisisModal triggering on benign text (false positives)
- CrisisModal _not_ triggering on real ideation (false negatives)
- Crisis-pattern audit log persistence or access
- Any path that lets an attacker read or write another user's data
- Authentication, authorization, or session-handling flaws
- Injection or RCE in the chat pipeline

## Out-of-scope (still welcome, but lower priority)

- The mock LLM reply (`mockReply()` in `src/screens/ChatScreen.tsx`) is intentionally deterministic before the real LLM ships; treat it as test-only.
- Denials of service that require the attacker to be the user themselves (a user can't DOS their own app meaningfully).
- Rate-limit bypasses before the real LLM ships (currently no server-side endpoint).

## Cryptographic notes

- Chat history is stored in `expo-secure-store` (iOS: Keychain, Android: Keystore).
- Mood entries and profile data are stored in `AsyncStorage` (unencrypted).
- The crisis-pattern audit log lives in SecureStore and is encrypted at rest by the OS.
- No backend = no transport encryption concern in v0.

## Bug bounty

Not yet. We may launch one for v1; this section will update.

## Audit history

- 2026-07-11: First comprehensive review (issue #1) — closed in issue #13.
- 2026-07-21: Post-merge audit (plans/03-post-merge-audit-2026-07-21.md) — 12-PR ship.
- 2026-07-22: Full codebase review (plans/05-full-codebase-review-2026-07-22.md) — 4-axis sweep.

For ongoing triage, see `~/.hermes/kanban/boards/fernly/state.json`.
