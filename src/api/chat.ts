// Chat backend adapter.
//
// v0.9: replace mockReply() in ChatScreen with a real fetch when
// EXPO_PUBLIC_CHAT_API_URL is set. The backend isn't shipped yet
// (the env var is unset in v0), so this is the wiring without the
// destination. Plans/05 P0-3 / F-P0-3.
//
// Contract:
//   - POST {EXPO_PUBLIC_CHAT_API_URL}/chat with { input, tone,
//     sessionId }
//   - Returns { reply: string } or throws.
//   - Timeout 12s — slower than that, the user has waited long enough
//     for a wellness-app reply.
//   - AbortSignal-aware so the chat-screen's unmount path can cancel
//     in-flight requests.
//
// Falls back to mockReply() at the call site when the env var is
// unset so v0 keeps working without a backend.

export interface ChatBackendConfig {
  /** base URL of the chat backend, no trailing slash. */
  url: string;
  /** request timeout in ms. */
  timeoutMs?: number;
  /** fetcher — defaults to global fetch. Tests inject a stub. */
  fetch?: typeof globalThis.fetch;
}

export interface ChatRequest {
  input: string;
  tone: 'soft' | 'direct' | 'playful';
  sessionId: string;
}

export interface ChatResponse {
  reply: string;
}

export class ChatBackendError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ChatBackendError';
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

/**
 * Fetch a chat reply from the configured backend. Throws
 * ChatBackendError on any failure the UI needs to know about.
 * The caller is expected to catch and fall back to mockReply() if
 * appropriate (see ChatScreen.send).
 */
export async function fetchReply(
  req: ChatRequest,
  config: ChatBackendConfig,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const timeoutMs = config.timeoutMs ?? 12_000;
  const f = config.fetch ?? globalThis.fetch;
  // Compose the user's signal with the timeout signal so either
  // source can cancel the request.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const onUserAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onUserAbort, { once: true });
  }
  try {
    const res = await f(`${config.url.replace(/\/+$/, '')}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new ChatBackendError(`Chat backend returned ${res.status}`, {
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const data = (await res.json()) as Partial<ChatResponse>;
    if (typeof data.reply !== 'string' || data.reply.length === 0) {
      throw new ChatBackendError('Chat backend returned empty reply', {
        status: res.status,
        retryable: true,
      });
    }
    return { reply: data.reply };
  } catch (err) {
    if (err instanceof ChatBackendError) throw err;
    // AbortError → the user navigated away mid-reply. Surface as
    // a non-retryable error so the catch site knows it's not a
    // network issue.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ChatBackendError('Chat request cancelled', { retryable: false });
    }
    // Anything else (network down, DNS, malformed JSON) → retryable.
    throw new ChatBackendError(err instanceof Error ? err.message : 'Chat request failed', {
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onUserAbort);
  }
}

/**
 * Read the chat backend URL from process.env. Returns null when the
 * env var is unset, in which case ChatScreen falls back to mockReply.
 *
 * Reading via process.env keeps tests deterministic — vitest can set
 * EXPO_PUBLIC_CHAT_API_URL and assert on the wired path.
 */
export function readChatBackendUrl(): string | null {
  const url = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CHAT_API_URL) || '';
  const trimmed = url.trim();
  // Strip a single trailing slash so callers can compose
  // `${url}/chat` without producing `/chat//chat` on a careless
  // config. Whitespace-only env still returns null.
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}
