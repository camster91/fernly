// Tests for src/util/date.ts — local-date string helpers.
//
// These run in Node (vitest environment: 'node' set in vitest.config.ts).
// Date semantics in Node are TZ-aware: setting TZ=America/Los_Angeles
// before importing the module pins the test to a specific offset, so
// we can assert the exact behavior for both west and east of UTC.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { localDateString, parseLocalDate } from '../date';

describe('localDateString', () => {
  // Pin timezone for deterministic assertions. We're testing "what the
  // user's wall clock shows", not "what JS Date does in this environment".
  const ORIGINAL_TZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  it('returns YYYY-MM-DD format for a noon local time', () => {
    // 12:00 PDT on July 22 is 19:00 UTC the same day → no boundary crossing
    const d = new Date('2026-07-22T12:00:00');
    expect(localDateString(d)).toBe('2026-07-22');
  });

  it('does NOT cross the date boundary in UTC at 11pm local', () => {
    // 11pm PDT on July 21 is 06:00 UTC on July 22. The UTC slicing
    // bug would return '2026-07-22'; the local helper returns the
    // user's local date '2026-07-21'. This is the P1-14 regression test.
    const d = new Date('2026-07-21T23:00:00');
    expect(localDateString(d)).toBe('2026-07-21');
  });

  it('crosses the date boundary correctly at midnight', () => {
    // 00:00:01 PDT on July 22 = 07:00:01 UTC July 22 → localDate = 22
    const d = new Date('2026-07-22T00:00:01');
    expect(localDateString(d)).toBe('2026-07-22');
  });

  it('pads single-digit months and days', () => {
    const d = new Date('2026-01-05T12:00:00');
    expect(localDateString(d)).toBe('2026-01-05');
  });

  it('handles Dec 31 -> Jan 1 rollover', () => {
    const d = new Date('2026-12-31T23:00:00');
    expect(localDateString(d)).toBe('2026-12-31');
  });

  it('defaults to today when called with no args', () => {
    // Don't assert an exact value (clock ticks); just assert format.
    expect(localDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseLocalDate', () => {
  it('parses a valid YYYY-MM-DD into local midnight', () => {
    const d = parseLocalDate('2026-07-22');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(6); // July (0-indexed)
    expect(d!.getDate()).toBe(22);
    expect(d!.getHours()).toBe(0);
    expect(d!.getMinutes()).toBe(0);
  });

  it('returns null for malformed input', () => {
    expect(parseLocalDate('not-a-date')).toBeNull();
    expect(parseLocalDate('2026/07/22')).toBeNull();
    expect(parseLocalDate('2026-7-22')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
  });

  it('returns null for impossible dates (e.g. Feb 31)', () => {
    expect(parseLocalDate('2026-02-31')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
  });

  it('round-trips with localDateString', () => {
    // A date string built from localDateString should parse back to
    // the same calendar day in local time.
    const original = new Date('2026-07-22T12:00:00');
    const iso = localDateString(original);
    const parsed = parseLocalDate(iso);
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(6);
    expect(parsed!.getDate()).toBe(22);
  });
});

describe('localDateString across timezones', () => {
  // Verify the helper fixes the bug regardless of which side of UTC
  // the user is on. The bug was that toISOString().slice() returns UTC
  // — a PST user logging at 11pm local got tomorrow's date; a JST user
  // logging at 1am local got yesterday's date. The local helper must
  // return the user's wall-clock date in both cases.

  function withTZ(tz: string, fn: () => void) {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  }

  it('PST: 11pm local on 2026-07-21 returns 2026-07-21 (not 2026-07-22)', () => {
    withTZ('America/Los_Angeles', () => {
      const d = new Date('2026-07-21T23:00:00');
      expect(localDateString(d)).toBe('2026-07-21');
    });
  });

  it('JST: 1am local on 2026-07-22 returns 2026-07-22 (not 2026-07-21)', () => {
    withTZ('Asia/Tokyo', () => {
      const d = new Date('2026-07-22T01:00:00');
      expect(localDateString(d)).toBe('2026-07-22');
    });
  });

  it('UTC: noon returns the same date', () => {
    withTZ('UTC', () => {
      const d = new Date('2026-07-22T12:00:00');
      expect(localDateString(d)).toBe('2026-07-22');
    });
  });
});
