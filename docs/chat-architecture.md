# Chat architecture (v0.11, issue #41)

This document describes the **client-side** architecture for the real
chat backend, including what is shipped, what is gated, and what is
intentionally left for future work. The actual backend project is
**not** in this repository — that is a separate deliverable waiting
on the dependencies listed below.

---

## 1. Goals

- **Versioned, authenticated API contract.** A client and backend
  written by different people (or at different times) must agree on
  the wire shape. The contract is a single TypeScript type, mirrored
  in a runtime validator, so a backend returning the wrong shape
  fails fast on the client.
- **Independent rollout flag.** A deployed build must be able to
  disable the real chat without rebuilding — the flag is a runtime
  decision, not a compile-time one.
- **Safety routing is independent of the model.** The crisis
  detector (`src/safety/crisis.ts`) runs BEFORE the network call.
  When it returns `hard`, the LLM never sees the message. This
  guarantee is a property of the call order in `ChatScreen.send`,
  not a property of the backend.
- **Cost limits.** A stuck UI, a runaway script, or a malicious
  token must not be able to spend unbounded money. The limiter is
  per-device, per-burst, and per-day.
- **Provider-change gate.** Accidentally swapping the URL during a
  deploy cannot quietly redirect traffic to a new provider. The
  host allowlist is enforced client-side, and a non-listed host
  fails closed.
- **Offline evaluation set.** Any change to the contract, the
  crisis detector, or the usage limits is gated by a CI test set
  (`scripts/eval-chat.test.ts`).

## 2. Architecture

```
  ┌──────────────┐  user text  ┌────────────────────┐
  │  ChatScreen  │────────────▶│  detectCrisis()    │
  │              │             │  (src/safety/)     │
  │              │             └────────┬───────────┘
  │              │            hard/soft/none
  │              │                      │
  │              │              ┌───────▼────────┐
  │              │   decision    │ resolveReal    │
  │              │◀─────────────│ ChatDecision() │
  │              │              └───────┬────────┘
  │              │                      │ enabled
  │              │              ┌───────▼────────┐
  │              │   ok / fail  │ reserveSlot()  │
  │              │◀─────────────│ (chat-usage)   │
  │              │              └───────┬────────┘
  │              │                      │ allowed
  │              │              ┌───────▼────────┐
  │              │   reply      │ fetchReply()   │
  │              │◀─────────────│ (chat)         │
  └──────────────┘              └────────────────┘
```

If ANY step declines, the chat falls back to the deterministic
`mockReply()` in `ChatScreen.tsx`. The user always gets a reply.

## 3. Contract

### Request

```
POST /v1/chat
Authorization: Bearer <token>           # required
X-Fernly-Client-Version: 0.11.0         # client semver
X-Fernly-Request-Id: <uuid>             # idempotency key
Content-Type: application/json

{
  "input": "<user text>",
  "tone": "soft" | "direct" | "playful",
  "sessionId": "<uuid>"
}
```

### Response (200)

```json
{
  "reply": "non-empty string",
  "safetyNotice": "optional string — client currently ignores"
}
```

### Errors

- 4xx → `ChatBackendError(kind: 'http', retryable: false)`.
- 429 / 5xx → `ChatBackendError(kind: 'http', retryable: true)`.
- Network failure → `ChatBackendError(kind: 'network', retryable: true)`.
- Timeout (>12s) → `ChatBackendError(kind: 'timeout', retryable: true)`.
- Malformed body → `ChatBackendError(kind: 'malformed', retryable: false)`.
- http:// URL → `ChatBackendError(kind: 'insecure', retryable: false)`.
- Host not in allowlist → `ChatBackendError(kind: 'host-not-allowed', retryable: false)`.
- No auth token → `ChatBackendError(kind: 'auth-missing', retryable: false)`.

The `kind` taxonomy lets the caller distinguish "fix your config"
(`insecure`, `host-not-allowed`, `auth-missing`) from "retry later"
(`http`, `network`, `timeout`) from "broken contract" (`malformed`).
Today the client logs and falls back to the mock in all cases; the
distinction is for the future "show the user a real error" path.

## 4. Feature flag

| Layer | Variable / Storage | Default | Effect |
|-------|--------------------|---------|--------|
| 1. URL | `EXPO_PUBLIC_CHAT_API_URL` env | unset | URL must be set for ANY real-chat traffic. |
| 2. Env flag | `EXPO_PUBLIC_CHAT_BACKEND_ENABLED` env | `false` | Build-time kill switch. |
| 3. Override | `@fernly/chat-backend-override` AsyncStorage | unset | Per-device toggle. `'1'` = force on, `'0'` = force off, `'unset'` = defer to env. |

All three must be truthy (URL set, env flag on, override not
explicitly false) for the backend to be reachable. The env flag is
the gate; the override is the switch.

The flag is consulted via `resolveRealChatDecision()` in
`src/api/chat-feature-flag.ts`. The async `isRealChatEnabled()` is
the convenience wrapper for the chat send hot path.

## 5. Usage limits

| Limit | Default | Override env | Purpose |
|-------|---------|--------------|---------|
| Burst | 5 calls / 60s | `EXPO_PUBLIC_CHAT_BURST_LIMIT` | Rapid double-tap, stuck UI. |
| Daily | 200 calls / day (local) | `EXPO_PUBLIC_CHAT_DAILY_LIMIT` | Cost cap. Per-day, local timezone, not UTC. |

Both limits are stored in `@fernly/chat-usage` AsyncStorage. The
slot is reserved BEFORE the network call. A reservation that hits
either limit falls back to the mock rather than failing the send —
the user still gets a reply and the cost cap holds.

Per-user override: `setDailyLimit(1..1000)` lets the user narrow
their own cap. Out-of-range values are silently ignored.

## 6. Memory policy

| Data | Where | Retention | Deletion |
|------|-------|-----------|----------|
| Chat text | SecureStore, per-session key | 200 messages per session (FIFO drop) | Per-session delete via `storage.deleteChatSession`; full reset via `clearAll`. |
| Crisis audit | SecureStore, single key | 500 entries (FIFO drop) | Survives `clearAll` by design. |
| Crisis resource reachability | AsyncStorage | 6h sliding TTL | Replaced on next post-launch HEAD check. |
| Usage counter | AsyncStorage | Day boundary in local time | Resets on day rollover; explicit `resetUsage()` available. |
| Chat backend override | AsyncStorage | Until cleared | `setRealChatOverride(null)` clears. |

The crisis audit survives `clearAll` because wiping chat history
must not erase the incident-response trail. See
`src/storage.ts` `clearAll` for the per-key enumeration.

## 7. Evaluation set

`scripts/eval-chat.test.ts` is the offline CI gate. It covers:

- **Crisis routing**: representative hard / soft / false-positive
  inputs and the expected detector verdict. A regression here
  would let a hard-crisis message reach the LLM, which is the
  single most important client-side guarantee.
- **Default-off**: the feature flag must be `false` in every
  configuration that doesn't explicitly enable it. A regression
  here would silently turn the backend on for an internal-cohort
  build that wasn't supposed to ship.
- **Pre-flight**: http://, off-allowlist, and missing-token
  requests are rejected before any network call. A regression
  here would leak the user's chat text in cleartext, route to a
  rogue host, or hold provider credentials in the client.
- **Schema validation**: malformed responses are rejected with
  `retryable: false` (a wrong-shape response is a deploy bug, not
  a transient failure).
- **Usage limits**: the burst and daily caps actually fire.

A change to the regex set in `src/safety/crisis.ts` or to the
contract in `src/api/chat.ts` MUST be accompanied by a new eval
case. The PR review checklist enforces this.

## 8. External dependencies (not shipped in this PR)

The following are prerequisites for actually deploying the
real-chat feature. They are out of scope for #41 (which is the
client-side architecture) and tracked separately:

- **Backend project.** A separate repo / service that implements
  the contract in section 3. Today this doesn't exist.
- **Auth provider.** #46 — the `getAuthToken` function in
  `fetchReply` is currently a stub returning `null`. Until #46
  ships, every real-chat call throws `auth-missing` and the
  client falls back to the mock.
- **Provider credentials.** Server-side only. The client never
  holds them. This is the "no provider credentials in the
  client" acceptance criterion — verified by the test
  `rejects when no auth token is provided`.
- **Hosting / environment approval.** The URL must be HTTPS and
  the host must be in the operator-controlled allowlist. The
  client enforces this; the operator's deploy config is the
  single source of truth for "which providers are sanctioned".
- **Content review.** Independent review of prompt changes before
  they ship. The eval set gates regressions; it does not replace
  human review of new prompts.
- **Human rollout approval.** Staged rollout (internal cohort
  → opt-in beta → public) requires human signoff at each step.
  The flag system supports this; the human gate does not.

## 9. How to enable the backend (operator runbook)

For an internal-cohort build:

1. Stand up a backend at `https://api.fernly.app` that
   implements the contract.
2. Verify the host is in your allowlist:
   `EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST=api.fernly.app`.
3. Turn the feature on for the cohort build only:
   `EXPO_PUBLIC_CHAT_BACKEND_ENABLED=true`.
4. Set the URL: `EXPO_PUBLIC_CHAT_API_URL=https://api.fernly.app`.
5. Wire `getAuthToken` to your auth provider (#46).
6. Ship the build. Internal testers see the real chat; everyone
   else still sees the mock.

To roll back without a rebuild:

- Set `EXPO_PUBLIC_CHAT_BACKEND_ENABLED=false` in the next build
  (the env flag ships with the build, so this is a build-level
  change, not a runtime one).
- OR push the AsyncStorage override to `'0'` on affected devices
  (requires a small remote-config or push layer — not in this
  repo yet, see #43).

## 10. Files

| File | Role |
|------|------|
| `src/api/chat.ts` | The contract: `fetchReply`, `ChatBackendError`, env helpers. |
| `src/api/chat-feature-flag.ts` | The feature flag: `resolveRealChatDecision`, override persistence. |
| `src/api/chat-usage.ts` | The cost limiter: `reserveSlot`, `getChatUsageSnapshot`. |
| `src/storage.ts` | Backing store for the override + usage counter. |
| `src/safety/crisis.ts` | The client-side crisis detector (unchanged). |
| `src/screens/ChatScreen.tsx` | The call orchestration: crisis → decision → reserve → fetch → fallback. |
| `src/__tests__/chat.api.test.ts` | Contract tests (HTTPS, allowlist, auth, schema, headers, errors). |
| `src/__tests__/chat-feature-flag.test.ts` | Feature flag tests (every config combination). |
| `src/__tests__/chat-usage.test.ts` | Usage limit tests (burst, daily, day rollover, persistence). |
| `scripts/eval-chat.test.ts` | Offline evaluation set (the CI gate). |
| `docs/chat-architecture.md` | This document. |
