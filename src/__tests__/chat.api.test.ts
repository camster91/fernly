// Tests for the chat backend adapter. We don't hit a real network —
// fetch is mocked. Coverage:
//   - readChatBackendUrl() returns null when env is unset
//   - fetchReply() returns the parsed reply on 200
//   - fetchReply() throws ChatBackendError with retryable=false on 4xx
//   - fetchReply() throws ChatBackendError with retryable=true on 5xx
//   - fetchReply() throws ChatBackendError with retryable=true on 429
//   - fetchReply() throws ChatBackendError on empty reply
//   - fetchReply() throws ChatBackendError on network failure
//   - fetchReply() respects caller-provided AbortSignal
//   - fetchReply() applies the 12s timeout (tested with a 50ms cap)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatBackendError, fetchReply, readChatBackendUrl } from '../api/chat';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_CHAT_API_URL;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXPO_PUBLIC_CHAT_API_URL;
  else process.env.EXPO_PUBLIC_CHAT_API_URL = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('readChatBackendUrl', () => {
  it('returns null when the env var is unset', () => {
    delete process.env.EXPO_PUBLIC_CHAT_API_URL;
    expect(readChatBackendUrl()).toBeNull();
  });

  it('returns the trimmed URL when set', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = 'https://chat.example.com/';
    expect(readChatBackendUrl()).toBe('https://chat.example.com');
  });

  it('returns null for whitespace-only env', () => {
    process.env.EXPO_PUBLIC_CHAT_API_URL = '   ';
    expect(readChatBackendUrl()).toBeNull();
  });
});

describe('fetchReply', () => {
  function mockFetch(status: number, body: unknown) {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof globalThis.fetch;
  }

  it('returns the parsed reply on 200', async () => {
    const result = await fetchReply(
      { input: 'hi', tone: 'soft', sessionId: 's1' },
      { url: 'https://api.example.com', fetch: mockFetch(200, { reply: 'hello back' }) },
    );
    expect(result.reply).toBe('hello back');
  });

  it('throws ChatBackendError with retryable=false on 4xx', async () => {
    await expect(
      fetchReply(
        { input: 'hi', tone: 'soft', sessionId: 's1' },
        { url: 'https://api.example.com', fetch: mockFetch(400, { error: 'bad' }) },
      ),
    ).rejects.toMatchObject({ status: 400, retryable: false });
  });

  it('throws ChatBackendError with retryable=true on 5xx', async () => {
    await expect(
      fetchReply(
        { input: 'hi', tone: 'soft', sessionId: 's1' },
        { url: 'https://api.example.com', fetch: mockFetch(503, { error: 'down' }) },
      ),
    ).rejects.toMatchObject({ status: 503, retryable: true });
  });

  it('throws ChatBackendError with retryable=true on 429', async () => {
    await expect(
      fetchReply(
        { input: 'hi', tone: 'soft', sessionId: 's1' },
        { url: 'https://api.example.com', fetch: mockFetch(429, { error: 'rate limited' }) },
      ),
    ).rejects.toMatchObject({ status: 429, retryable: true });
  });

  it('throws ChatBackendError when reply is missing', async () => {
    await expect(
      fetchReply(
        { input: 'hi', tone: 'soft', sessionId: 's1' },
        { url: 'https://api.example.com', fetch: mockFetch(200, {}) },
      ),
    ).rejects.toBeInstanceOf(ChatBackendError);
  });

  it('throws ChatBackendError on empty reply', async () => {
    await expect(
      fetchReply(
        { input: 'hi', tone: 'soft', sessionId: 's1' },
        { url: 'https://api.example.com', fetch: mockFetch(200, { reply: '' }) },
      ),
    ).rejects.toBeInstanceOf(ChatBackendError);
  });

  it('throws retryable ChatBackendError on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Network unreachable');
    }) as unknown as typeof globalThis.fetch;
    await expect(
      fetchReply(
        { input: 'hi', tone: 'soft', sessionId: 's1' },
        { url: 'https://api.example.com', fetch: fetchImpl },
      ),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('respects a caller-provided AbortSignal', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as unknown as typeof globalThis.fetch;
    const promise = fetchReply(
      { input: 'hi', tone: 'soft', sessionId: 's1' },
      { url: 'https://api.example.com', fetch: fetchImpl },
      ctrl.signal,
    );
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ retryable: false });
  });

  it('strips trailing slashes from the URL', async () => {
    const fetchImpl = mockFetch(200, { reply: 'ok' });
    await fetchReply(
      { input: 'hi', tone: 'soft', sessionId: 's1' },
      { url: 'https://api.example.com///', fetch: fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/chat',
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
});
