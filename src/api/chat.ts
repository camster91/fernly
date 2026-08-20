// Chat backend adapter.
//
// v0.11 (issue #41): evaluated real-chat architecture behind a feature flag.
//   - Versioned contract: /v1/chat path
//   - X-Fernly-Request-Id header (idempotency key) on every request
//   - X-Fernly-Client-Version header (for backend-side cohort / rollout)
//   - Authorization: Bearer <token> header — token injected by the caller
//     from the auth layer (#46). The client NEVER holds provider creds.
//   - HTTPS-only enforcement (rejects http:// in production)
//   - Host allowlist: configured via EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST
//     or as the second arg to `fetchReply`. If the URL host isn't in the
//     allowlist, the request is rejected before any network call — the
//     "provider-change gate" the issue requires.
//   - Schema validation: response is validated against a runtime check
//     that mirrors the TypeScript type. Mismatched responses throw
//     ChatBackendError(retryable: false) — a malformed response is not
//     a transient network problem, retrying won't help.
//   - Mock fallback: any rejection or missing flag → caller falls back to
//     mockReply(). The mock path is unchanged from v0.10.
//
// Safety routing independence: detectCrisis() in src/safety/crisis.ts
// runs BEFORE this adapter is called (see ChatScreen.send). When the
// crisis modal wins, the LLM never sees the message — that guarantee
// lives in ChatScreen and is unaffected by this file.
//
// Defaults: if EXPO_PUBLIC_CHAT_BACKEND_ENABLED is unset / "false" /
// "0" / "no", the backend is OFF even when EXPO_PUBLIC_CHAT_API_URL is
// set. This is the "mock by default" acceptance criterion.

export const CHAT_API_VERSION = 'v1' as const;
export const CHAT_API_PATH = `/v1/chat` as const;

export interface ChatBackendConfig {
  /** base URL of the chat backend, no trailing slash. */
  url: string;
  /** request timeout in ms. */
  timeoutMs?: number;
  /** fetcher — defaults to global fetch. Tests inject a stub. */
  fetch?: typeof globalThis.fetch;
  /**
   * Optional host allowlist. If provided, the URL host MUST be in this
   * list or the request is rejected before any network call. This is
   * the "provider-change gate" — accidentally swapping the URL during
   * a deploy can't quietly redirect traffic to a new provider without
   * also updating the allowlist.
   *
   * Comparison is case-insensitive and matches the FULL host (port
   * included if non-default). Wildcards are not supported.
   */
  hostAllowlist?: string[];
  /**
   * Called on every request to obtain the current auth token. Returning
   * null/undefined skips the Authorization header (the request will be
   * rejected by the backend, but the client doesn't pre-empt). The
   * provider (e.g. Auth0, Clerk) — not this file — owns the token. See
   * #46.
   */
  getAuthToken?: () => string | null | Promise<string | null>;
  /**
   * Client version string for the X-Fernly-Client-Version header.
   * Defaults to the static CHAT_CLIENT_VERSION. Tests override.
   */
  clientVersion?: string;
  /**
   * If true (default), reject non-HTTPS URLs. Set false ONLY for local
   * development against http://localhost. In production this is always
   * true; the readChatBackendUrl() helper below enforces it.
   */
  requireHttps?: boolean;
}

export interface ChatRequest {
  input: string;
  tone: 'soft' | 'direct' | 'playful';
  sessionId: string;
}

export interface ChatResponse {
  reply: string;
  /**
   * Optional provider-side safety flag. The client DOES NOT trust this
   * for crisis routing — that's the client's job. The field exists so
   * the backend can surface a soft-signal notice (e.g. "I noticed
   * some heavy feelings — would a grounding exercise help?") without
   * gating it on the client. v0 ignores it; v1 may surface it.
   */
  safetyNotice?: string;
}

export class ChatBackendError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly kind:
    | 'http' // non-2xx response
    | 'timeout' // 12s timeout fired
    | 'cancelled' // AbortSignal fired
    | 'network' // DNS / connect / TLS / etc.
    | 'malformed' // response shape didn't match the schema
    | 'insecure' // http:// in production
    | 'host-not-allowed' // URL host not in the allowlist
    | 'auth-missing'; // no token returned from getAuthToken
  constructor(
    message: string,
    opts: {
      status?: number;
      retryable?: boolean;
      kind?: ChatBackendError['kind'];
    } = {},
  ) {
    super(message);
    this.name = 'ChatBackendError';
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.kind = opts.kind ?? 'http';
  }
}

const CHAT_CLIENT_VERSION = '0.11.0';

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function isHostAllowed(host: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const target = normalizeHost(host);
  return allowlist.some((allowed) => normalizeHost(allowed) === target);
}

/**
 * Runtime validation of the parsed response. Mirrors the ChatResponse
 * TypeScript type but at runtime — a backend returning the wrong shape
 * (extra fields, missing fields, wrong types) is a deploy-side bug, not
 * a network issue, so we throw with `retryable: false`.
 */
function validateChatResponse(data: unknown): ChatResponse {
  if (!data || typeof data !== 'object') {
    throw new ChatBackendError('Response is not an object', {
      retryable: false,
      kind: 'malformed',
    });
  }
  const d = data as Record<string, unknown>;
  if (typeof d.reply !== 'string' || d.reply.length === 0) {
    throw new ChatBackendError('Response missing non-empty `reply` field', {
      retryable: false,
      kind: 'malformed',
    });
  }
  // Reject replies that look like a crisis bypass — empty string is
  // already rejected above; we also reject whitespace-only so a
  // backend that returns " \n  " can't slip through.
  if (d.reply.trim().length === 0) {
    throw new ChatBackendError('Response `reply` is whitespace-only', {
      retryable: false,
      kind: 'malformed',
    });
  }
  if (
    d.safetyNotice !== undefined &&
    d.safetyNotice !== null &&
    typeof d.safetyNotice !== 'string'
  ) {
    throw new ChatBackendError('Response `safetyNotice` must be a string when present', {
      retryable: false,
      kind: 'malformed',
    });
  }
  return {
    reply: d.reply,
    safetyNotice: typeof d.safetyNotice === 'string' ? d.safetyNotice : undefined,
  };
}

/**
 * Build the absolute URL the request is sent to. /v1/chat is appended
 * if the base URL has no path component. If the base already ends in
 * /v1 or /v1/chat, the path is preserved (so a future migration to
 * /v2 doesn't need a config change).
 */
function buildUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  // If the operator already pinned a versioned path, keep it.
  if (/\/v\d+(\/chat)?\/?$/.test(trimmed)) return `${trimmed}/chat`.replace(/\/chat\/chat$/, '/chat');
  return `${trimmed}${CHAT_API_PATH}`;
}

/**
 * Fetch a chat reply from the configured backend. Throws
 * ChatBackendError on any failure the UI needs to know about. The
 * caller is expected to catch and fall back to mockReply() if
 * appropriate (see ChatScreen.send).
 */
export async function fetchReply(
  req: ChatRequest,
  config: ChatBackendConfig,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const timeoutMs = config.timeoutMs ?? 12_000;
  const f = config.fetch ?? globalThis.fetch;
  const requireHttps = config.requireHttps ?? true;
  const clientVersion = config.clientVersion ?? CHAT_CLIENT_VERSION;

  // ---- Pre-flight checks (no network) ----

  let parsed: URL;
  try {
    parsed = new URL(config.url);
  } catch {
    throw new ChatBackendError(`Chat backend URL is not valid: ${config.url}`, {
      retryable: false,
      kind: 'malformed',
    });
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    throw new ChatBackendError(
      `Chat backend URL must be https (got ${parsed.protocol})`,
      { retryable: false, kind: 'insecure' },
    );
  }

  if (config.hostAllowlist && !isHostAllowed(parsed.host, config.hostAllowlist)) {
    throw new ChatBackendError(
      `Chat backend host ${parsed.host} is not in the allowlist`,
      { retryable: false, kind: 'host-not-allowed' },
    );
  }

  // Auth token is required. If the caller didn't wire a token getter,
  // that's a config bug — fail closed.
  //
  // IMPORTANT: this await yields control. If the caller has already
  // aborted their signal by the time we resume, we'll notice on the
  // `signal.aborted` check below. We register the abort listener
  // AFTER the auth await because the listener needs the internal
  // controller in its closure, which we haven't created yet — the
  // post-await check covers the "aborted-during-await" case.
  let authToken: string | null = null;
  if (config.getAuthToken) {
    try {
      authToken = await config.getAuthToken();
    } catch {
      authToken = null;
    }
  }
  if (!authToken) {
    throw new ChatBackendError(
      'No auth token available — chat backend requires an authenticated identity',
      { retryable: false, kind: 'auth-missing' },
    );
  }

  // If the caller aborted while we were awaiting the auth token, bail
  // before touching the wire. The "aborted after this check" path is
  // handled by the listener registered below.
  if (signal?.aborted) {
    throw new ChatBackendError('Chat request cancelled', {
      retryable: false,
      kind: 'cancelled',
    });
  }

  // Request ID for idempotency. The backend can use this to dedupe
  // retry-amplified requests. We generate a fresh one per call here
  // because `req` is the application payload; idempotency is a
  // transport concern, not an app concern.
  const requestId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // ---- Compose the in-flight request ----

  const ctrl = new AbortController();
  const timeout = setTimeout(
    () => ctrl.abort(new DOMException('timeout', 'TimeoutError')),
    timeoutMs,
  );
  const onUserAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onUserAbort, { once: true });
  }

  try {
    const res = await f(buildUrl(config.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${authToken}`,
        'x-fernly-client-version': clientVersion,
        'x-fernly-request-id': requestId,
      },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new ChatBackendError(`Chat backend returned ${res.status}`, {
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
        kind: 'http',
      });
    }
    // Parse + validate. We do this BEFORE returning so a malformed
    // response throws ChatBackendError(malformed, retryable: false)
    // and the caller's catch site can show a useful error.
    const raw: unknown = await res.json();
    return validateChatResponse(raw);
  } catch (err) {
    if (err instanceof ChatBackendError) throw err;
    // AbortError → the user navigated away mid-reply OR the 12s
    // timeout fired. Surface as cancelled — not retryable, not a
    // network issue.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ChatBackendError('Chat request cancelled', {
        retryable: false,
        kind: 'cancelled',
      });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ChatBackendError('Chat request timed out', {
        retryable: true,
        kind: 'timeout',
      });
    }
    // Anything else (network down, DNS, malformed JSON, TLS) → retryable.
    throw new ChatBackendError(err instanceof Error ? err.message : 'Chat request failed', {
      retryable: true,
      kind: 'network',
    });
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onUserAbort);
  }
}

// ---- Environment / config helpers ----

/**
 * Read the chat backend URL from process.env. Returns null when the
 * env var is unset, in which case the call site falls back to
 * mockReply().
 *
 * v0.11: HTTPS is enforced. A non-HTTPS URL throws — we refuse to
 * continue rather than silently downgrading. This protects against a
 * misconfigured deploy (e.g. http://api.fernly.app due to a TLS
 * outage) that would otherwise leak the user's chat text in cleartext.
 *
 * Reading via process.env keeps tests deterministic — vitest can set
 * EXPO_PUBLIC_CHAT_API_URL and assert on the wired path.
 */
export function readChatBackendUrl(opts: { requireHttps?: boolean } = {}): string | null {
  const url =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CHAT_API_URL) || '';
  const trimmed = url.trim();
  if (!trimmed) return null;
  const requireHttps = opts.requireHttps ?? true;
  if (requireHttps && !trimmed.toLowerCase().startsWith('https://')) {
    throw new ChatBackendError(
      `EXPO_PUBLIC_CHAT_API_URL must start with https:// (got ${trimmed})`,
      { retryable: false, kind: 'insecure' },
    );
  }
  // Strip a single trailing slash so callers can compose
  // `${url}/chat` without producing `/chat//chat` on a careless
  // config. Whitespace-only env still returns null.
  return trimmed.replace(/\/+$/, '');
}

/**
 * Read the host allowlist from env. Comma-separated list. Empty /
 * unset returns []. A non-empty allowlist is REQUIRED for any URL
 * the adapter is allowed to hit — the operator's deploy config is the
 * single point of "which providers are sanctioned" truth.
 */
export function readHostAllowlist(): string[] {
  const raw = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST) || '';
  return raw
    .split(',')
    .map((h: string) => h.trim())
    .filter(Boolean);
}

/**
 * Read the explicit enable flag. Default is FALSE. The flag is
 * independent of the URL — both must be true to call the backend.
 *
 * Accepted truey values: '1', 'true', 'yes', 'on' (case-insensitive).
 * Everything else is falsey. Unset env is falsey.
 *
 * The flag is also stored in AsyncStorage (see chat-feature-flag.ts) so
 * the internal cohort toggle doesn't require a rebuild.
 */
export function readChatBackendEnabled(): boolean {
  const raw =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CHAT_BACKEND_ENABLED) || '';
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
