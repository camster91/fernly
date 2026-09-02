// Tests for the chat backend adapter (v0.11, issue #41).
//
// We don't hit a real network — fetch is mocked. Coverage:
//   - readChatBackendUrl() returns null when env is unset
//   - readChatBackendUrl() throws on http:// (HTTPS enforcement)
//   - readChatBackendUrl() returns the trimmed https URL when set
//   - readHostAllowlist() parses comma-separated env
//   - readChatBackendEnabled() defaults false; accepts "1"/"true"/"yes"/"on"
//   - fetchReply() returns the parsed reply on 200
//   - fetchReply() hits the /v1/chat path
//   - fetchReply() sends Authorization, X-Fernly-Request-Id, X-Fernly-Client-Version
//   - fetchReply() throws ChatBackendError with retryable=false on 4xx
//   - fetchReply() throws ChatBackendError with retryable=true on 5xx
//   - fetchReply() throws ChatBackendError with retryable=true on 429
//   - fetchReply() throws ChatBackendError(malformed) on missing reply
//   - fetchReply() throws ChatBackendError(malformed) on empty reply
//   - fetchReply() throws ChatBackendError(malformed) on whitespace-only reply
//   - fetchReply() throws ChatBackendError(malformed) on non-object body
//   - fetchReply() throws ChatBackendError(malformed) on safetyNotice type mismatch
//   - fetchReply() throws ChatBackendError(network) on network failure
//   - fetchReply() throws ChatBackendError(cancelled) on caller AbortSignal
//   - fetchReply() throws ChatBackendError(insecure) on http URL
//   - fetchReply() throws ChatBackendError(host-not-allowed) when host not in allowlist
//   - fetchReply() throws ChatBackendError(auth-missing) when getAuthToken returns null
//   - fetchReply() requires getAuthToken to be configured
//   - fetchReply() applies the 12s timeout (tested with a 50ms cap)

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatBackendError,
  CHAT_API_PATH,
  CHAT_API_VERSION,
  fetchReply,
  readChatBackendEnabled,
  readChatBackendUrl,
  readHostAllowlist,
} from '../api/chat';

const ENV_KEYS = [
  'EXPO_PUBLIC_CHAT_API_URL',
  'EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST',
  'EXPO_PUBLIC_CHAT_BACKEND_ENABLED',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof globalThis.fetch;
}

const VALID_REQ = { input: 'hi', tone: 'soft' as const, sessionId: 's1' };

describe('readChatBackendUrl', () => {
  it('returns null when the env var is unset', () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    expect(readChatBackendUrl()).toBeNull();
  });

  it('returns the trimmed https URL when set', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://chat.example.com/';
    expect(readChatBackendUrl()).toBe('https://chat.example.com');
  });

  it('returns null for whitespace-only env', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = '   ';
    expect(readChatBackendUrl()).toBeNull();
  });

  it('throws ChatBackendError(insecure) on http:// (HTTPS enforcement)', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'http://chat.example.com';
    expect(() => readChatBackendUrl()).toThrow(ChatBackendError);
    try {
      readChatBackendUrl();
    } catch (e) {
      expect(e).toBeInstanceOf(ChatBackendError);
      expect((e as ChatBackendError).kind).toBe('insecure');
      expect((e as ChatBackendError).retryable).toBe(false);
    }
  });

  it('allows http:// when requireHttps is explicitly false (dev only)', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'http://localhost:8080';
    expect(readChatBackendUrl({ requireHttps: false })).toBe('http://localhost:8080');
  });
});

describe('readHostAllowlist', () => {
  it('returns [] when env is unset', () => {
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST;
    expect(readHostAllowlist()).toEqual([]);
  });
  it('parses comma-separated entries and trims whitespace', () => {
    process.env.EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST =
      'api.fernly.app, staging.fernly.app ,api2.fernly.app';
    expect(readHostAllowlist()).toEqual(['api.fernly.app', 'staging.fernly.app', 'api2.fernly.app']);
  });
  it('drops empty entries', () => {
    process.env.EXPO_PUBLIC_CHAT_BACKEND_HOST_ALLOWLIST = ',,api.fernly.app,,';
    expect(readHostAllowlist()).toEqual(['api.fernly.app']);
  });
});

describe('readChatBackendEnabled', () => {
  it('defaults to false when env is unset', () => {
    delete process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED;
    expect(readChatBackendEnabled()).toBe(false);
  });
  it('is true for "1"', () => {
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = '1';
    expect(readChatBackendEnabled()).toBe(true);
  });
  it('is true for "true" (case-insensitive)', () => {
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'TRUE';
    expect(readChatBackendEnabled()).toBe(true);
  });
  it('is true for "yes" and "on"', () => {
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'yes';
    expect(readChatBackendEnabled()).toBe(true);
    process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = 'on';
    expect(readChatBackendEnabled()).toBe(true);
  });
  it('is false for "0" / "false" / arbitrary strings', () => {
    for (const v of ['0', 'false', 'no', 'off', 'enabled', 'random']) {
      process.env.EXPO_PUBLIC_CHAT_BACKEND_ENABLED = v;
      expect(readChatBackendEnabled()).toBe(false);
    }
  });
});

describe('fetchReply', () => {
  it('returns the parsed reply on 200', async () => {
    const result = await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: mockFetch(200, { reply: 'hello back' }),
      getAuthToken: () => 'test-token',
    });
    expect(result.reply).toBe('hello back');
  });

  it('hits the /v1/chat endpoint', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: f,
      getAuthToken: () => 'test-token',
    });
    expect(f).toHaveBeenCalledWith(
      `https://api.example.com${CHAT_API_PATH}`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(CHAT_API_PATH).toBe('/v1/chat');
    expect(CHAT_API_VERSION).toBe('v1');
  });

  it('sends Authorization, X-Fernly-Request-Id, and X-Fernly-Client-Version headers', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: f,
      getAuthToken: () => 'test-token',
    });
    const call = (f as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-token');
    expect(headers['x-fernly-request-id']).toMatch(/.+/);
    expect(headers['x-fernly-client-version']).toMatch(/.+/);
  });

  it('each request has a unique X-Fernly-Request-Id', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: f,
      getAuthToken: () => 'test-token',
    });
    await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: f,
      getAuthToken: () => 'test-token',
    });
    const headers1 = (f as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Record<string, string>;
    const headers2 = (f as ReturnType<typeof vi.fn>).mock.calls[1][1].headers as Record<string, string>;
    expect(headers1['x-fernly-request-id']).not.toBe(headers2['x-fernly-request-id']);
  });

  it('throws ChatBackendError(insecure) on http:// in production', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'http://api.example.com',
        fetch: f,
        getAuthToken: () => 'test-token',
      }),
    ).rejects.toMatchObject({ kind: 'insecure', retryable: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('throws ChatBackendError(host-not-allowed) when host is not in the allowlist', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        hostAllowlist: ['allowed.fernly.app'],
        fetch: f,
        getAuthToken: () => 'test-token',
      }),
    ).rejects.toMatchObject({ kind: 'host-not-allowed', retryable: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('throws ChatBackendError(host-not-allowed) when allowlist is provided but empty', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        hostAllowlist: [],
        fetch: f,
        getAuthToken: () => 'test-token',
      }),
    ).rejects.toMatchObject({ kind: 'host-not-allowed' });
    expect(f).not.toHaveBeenCalled();
  });

  it('passes the host-allowlist check (case-insensitive)', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://API.Example.COM',
        hostAllowlist: ['api.example.com'],
        fetch: f,
        getAuthToken: () => 'test-token',
      }),
    ).resolves.toEqual({ reply: 'ok' });
  });

  it('throws ChatBackendError(auth-missing) when no getAuthToken is provided', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: f,
      }),
    ).rejects.toMatchObject({ kind: 'auth-missing', retryable: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('throws ChatBackendError(auth-missing) when getAuthToken returns null', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: f,
        getAuthToken: () => null,
      }),
    ).rejects.toMatchObject({ kind: 'auth-missing' });
    expect(f).not.toHaveBeenCalled();
  });

  it('awaits an async getAuthToken', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: f,
      getAuthToken: async () => 'async-token',
    });
    const init = (f as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer async-token');
  });

  it('treats a throwing getAuthToken as auth-missing (no token returned)', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: f,
        getAuthToken: () => {
          throw new Error('token store offline');
        },
      }),
    ).rejects.toMatchObject({ kind: 'auth-missing' });
    expect(f).not.toHaveBeenCalled();
  });

  it('throws ChatBackendError(http) with retryable=false on 4xx', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(400, { error: 'bad' }),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 400, retryable: false });
  });

  it('throws ChatBackendError(http) with retryable=true on 5xx', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(503, { error: 'down' }),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 503, retryable: true });
  });

  it('throws ChatBackendError(http) with retryable=true on 429', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(429, { error: 'rate limited' }),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 429, retryable: true });
  });

  it('throws ChatBackendError(malformed) when reply field is missing', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(200, {}),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed', retryable: false });
  });

  it('throws ChatBackendError(malformed) when reply is empty string', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(200, { reply: '' }),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('throws ChatBackendError(malformed) when reply is whitespace-only', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(200, { reply: '   \n  ' }),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('throws ChatBackendError(malformed) when body is not an object', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(200, 'just a string'),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('throws ChatBackendError(malformed) when safetyNotice is wrong type', async () => {
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: mockFetch(200, { reply: 'ok', safetyNotice: 42 }),
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('accepts safetyNotice as string', async () => {
    const result = await fetchReply(VALID_REQ, {
      url: 'https://api.example.com',
      fetch: mockFetch(200, { reply: 'ok', safetyNotice: 'soft tone' }),
      getAuthToken: () => 't',
    });
    expect(result.safetyNotice).toBe('soft tone');
  });

  it('throws ChatBackendError(network) with retryable=true on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Network unreachable');
    }) as unknown as typeof globalThis.fetch;
    await expect(
      fetchReply(VALID_REQ, {
        url: 'https://api.example.com',
        fetch: fetchImpl,
        getAuthToken: () => 't',
      }),
    ).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it('throws ChatBackendError(cancelled) when the caller aborts', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as unknown as typeof globalThis.fetch;
    const promise = fetchReply(
      VALID_REQ,
      { url: 'https://api.example.com', fetch: fetchImpl, getAuthToken: () => 't' },
      ctrl.signal,
    );
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
  });

  it('throws ChatBackendError(timeout) when the 12s timeout fires', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'TimeoutError';
          reject(e);
        });
      });
    }) as unknown as typeof globalThis.fetch;
    const promise = fetchReply(
      VALID_REQ,
      { url: 'https://api.example.com', fetch: fetchImpl, getAuthToken: () => 't', timeoutMs: 50 },
    );
    await expect(promise).rejects.toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('strips trailing slashes from the URL', async () => {
    const f = mockFetch(200, { reply: 'ok' });
    await fetchReply(VALID_REQ, {
      url: 'https://api.example.com///',
      fetch: f,
      getAuthToken: () => 't',
    });
    expect(f).toHaveBeenCalledWith(
      `https://api.example.com${CHAT_API_PATH}`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('ChatBackendError', () => {
  it('is an Error subclass with name set', () => {
    const err = new ChatBackendError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ChatBackendError');
  });

  it('defaults kind to "http" for backwards compat', () => {
    const err = new ChatBackendError('msg');
    expect(err.kind).toBe('http');
  });
});
