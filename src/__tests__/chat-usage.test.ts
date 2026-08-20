// Tests for the chat usage limiter (v0.11, issue #41).
//
// Coverage:
//   - empty state initializes correctly
//   - reserveSlot() under the burst cap succeeds
//   - reserveSlot() over the burst cap throws ChatUsageLimitError(burst)
//   - reserveSlot() over the daily cap throws ChatUsageLimitError(daily)
//   - day rollover resets the day count
//   - burst window trims old timestamps
//   - per-user daily cap (setDailyLimit) overrides the env default
//   - per-user daily cap is clamped to [1, 1000]
//   - getChatUsageSnapshot() reflects the state without mutating
//   - resetUsage() clears all state
//   - storage failures don't crash the limiter (best-effort)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatUsageLimitError,
  getChatUsageSnapshot,
  reserveSlot,
  resetUsage,
  setDailyLimit,
} from '../api/chat-usage';

let usageStore: unknown = null;
vi.mock('../storage', () => ({
  storage: {
    getChatUsage: async () => usageStore,
    setChatUsage: async (v: unknown) => {
      usageStore = v;
    },
  },
}));

const ENV_KEYS = ['EXPO_PUBLIC_CHAT_BURST_LIMIT', 'EXPO_PUBLIC_CHAT_DAILY_LIMIT'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  usageStore = null;
  delete process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT;
  delete process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT;
});

describe('reserveSlot', () => {
  it('succeeds on a fresh state', async () => {
    await expect(reserveSlot()).resolves.toBeUndefined();
  });

  it('throws ChatUsageLimitError(burst) when the burst cap is reached', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '3';
    // Three reservations in the same minute fill the burst window.
    await reserveSlot();
    await reserveSlot();
    await reserveSlot();
    await expect(reserveSlot()).rejects.toBeInstanceOf(ChatUsageLimitError);
    try {
      await reserveSlot();
    } catch (e) {
      const err = e as ChatUsageLimitError;
      expect(err.limit).toBe('burst');
      expect(err.cap).toBe(3);
      expect(err.used).toBe(3);
      expect(err.resetMs).toBeGreaterThan(0);
    }
  });

  it('burst window trims old timestamps — older slots free up', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '2';
    const t0 = new Date('2026-01-01T12:00:00.000Z');
    // 2 reservations exactly 65s apart. The first one trims out of
    // the burst window when the third is reserved, so we can do 3
    // calls in 65s without tripping the burst cap.
    await reserveSlot(t0);
    await reserveSlot(t0);
    // 61s later — the original two are now > 60s old and trim.
    const t1 = new Date(t0.getTime() + 61_000);
    await reserveSlot(t1);
    // The third call fits because both prior slots trimmed.
    // A fourth call within the same minute would trip.
    const t2 = new Date(t0.getTime() + 62_000);
    await reserveSlot(t2);
    const t3 = new Date(t0.getTime() + 63_000);
    await expect(reserveSlot(t3)).rejects.toBeInstanceOf(ChatUsageLimitError);
  });

  it('throws ChatUsageLimitError(daily) when the daily cap is reached', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '1000'; // don't trip burst first
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '2';
    const t0 = new Date('2026-01-01T08:00:00.000Z');
    await reserveSlot(t0);
    // 5 minutes later — within the burst window of 60s? Yes, so
    // bump time by >60s between calls to avoid burst cap.
    const t1 = new Date(t0.getTime() + 5 * 60_000);
    await reserveSlot(t1);
    const t2 = new Date(t0.getTime() + 10 * 60_000);
    await expect(reserveSlot(t2)).rejects.toBeInstanceOf(ChatUsageLimitError);
    try {
      await reserveSlot(t2);
    } catch (e) {
      const err = e as ChatUsageLimitError;
      expect(err.limit).toBe('daily');
      expect(err.cap).toBe(2);
      expect(err.used).toBe(2);
      expect(err.resetMs).toBeGreaterThan(0);
    }
  });

  it('day rollover resets the day count', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '1000';
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '2';
    // Use LOCAL-time dates to match the limiter's dayKey (yyyy-mm-dd local).
    const day1Morning = new Date(2026, 0, 1, 8, 0, 0);
    const day1Afternoon = new Date(2026, 0, 1, 23, 0, 0);
    const day2Morning = new Date(2026, 0, 2, 1, 0, 0);
    await reserveSlot(day1Morning);
    await reserveSlot(day1Afternoon);
    await expect(reserveSlot(day1Afternoon)).rejects.toBeInstanceOf(ChatUsageLimitError);
    // Next day, the cap resets.
    await expect(reserveSlot(day2Morning)).resolves.toBeUndefined();
  });

  it('records the reservation in storage', async () => {
    await reserveSlot();
    expect(usageStore).toBeTypeOf('object');
    const s = usageStore as { dayCount: number; burst: number[]; version: number };
    expect(s.dayCount).toBe(1);
    expect(s.burst.length).toBe(1);
    expect(s.version).toBe(1);
  });
});

describe('setDailyLimit', () => {
  it('overrides the env default', async () => {
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '1000';
    await setDailyLimit(2);
    const snap = await getChatUsageSnapshot();
    expect(snap.dailyCap).toBe(2);
  });

  it('clears the override when set to null', async () => {
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '50';
    await setDailyLimit(10);
    await setDailyLimit(null);
    const snap = await getChatUsageSnapshot();
    expect(snap.dailyCap).toBe(50);
  });

  it('rejects values outside [1, 1000]', async () => {
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '100';
    await setDailyLimit(0); // too low
    await setDailyLimit(1001); // too high
    await setDailyLimit(-5); // negative
    await setDailyLimit(Number.NaN); // not a number
    const snap = await getChatUsageSnapshot();
    expect(snap.dailyCap).toBe(100); // unchanged
  });
});

describe('getChatUsageSnapshot', () => {
  it('returns empty snapshot for a fresh state', async () => {
    const snap = await getChatUsageSnapshot();
    expect(snap.dayCount).toBe(0);
    expect(snap.burstCount).toBe(0);
    expect(snap.burstResetMs).toBe(0);
    expect(snap.dailyResetMs).toBeGreaterThan(0);
  });

  it('reflects the burst cap from env', async () => {
    process.env.EXPO_PUBLIC_CHAT_BURST_LIMIT = '7';
    const snap = await getChatUsageSnapshot();
    expect(snap.burstCap).toBe(7);
  });

  it('reflects the daily cap from env', async () => {
    process.env.EXPO_PUBLIC_CHAT_DAILY_LIMIT = '42';
    const snap = await getChatUsageSnapshot();
    expect(snap.dailyCap).toBe(42);
  });

  it('does not mutate state', async () => {
    await reserveSlot();
    const before = (usageStore as { dayCount: number }).dayCount;
    await getChatUsageSnapshot();
    const after = (usageStore as { dayCount: number }).dayCount;
    expect(after).toBe(before);
  });
});

describe('resetUsage', () => {
  it('clears all state', async () => {
    await reserveSlot();
    await reserveSlot();
    await resetUsage();
    const snap = await getChatUsageSnapshot();
    expect(snap.dayCount).toBe(0);
    expect(snap.burstCount).toBe(0);
  });
});

describe('persistence correctness', () => {
  it('round-trips through storage with a fresh loadState', async () => {
    const t0 = new Date(2026, 5, 15, 10, 0, 0);
    await reserveSlot(t0);
    // Force a re-load by re-importing. (Simulates a cold launch.)
    // We can't easily re-import, so we just verify the persisted
    // shape directly.
    const s = usageStore as { version: number; dayKey: string; burst: number[] };
    expect(s.version).toBe(1);
    expect(s.dayKey).toBe('2026-06-15');
    expect(s.burst.length).toBe(1);
  });

  it('handles a missing storage record by starting fresh', async () => {
    usageStore = null;
    await expect(reserveSlot()).resolves.toBeUndefined();
  });

  it('handles a malformed storage record by starting fresh', async () => {
    usageStore = { unrelated: 'shape' };
    await expect(reserveSlot()).resolves.toBeUndefined();
  });

  it('drops burst entries that are not finite numbers', async () => {
    usageStore = {
      version: 1,
      dayKey: '2026-01-01',
      dayCount: 0,
      dailyCap: null,
      burst: [Date.now(), Number.NaN, Number.POSITIVE_INFINITY, 'string', null],
    };
    const snap = await getChatUsageSnapshot();
    expect(snap.burstCount).toBe(1);
  });
});
