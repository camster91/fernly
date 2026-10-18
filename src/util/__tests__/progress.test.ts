// Tests for src/util/progress.ts — pure progress helpers.
//
// TZ is pinned the same way src/util/__tests__/date.test.ts does it, so
// local-day boundaries are deterministic.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  currentStreak,
  isComplete,
  sessionsCompleted,
  totalMinutes,
  type SessionCompletion,
} from '../progress';

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

function completion(sessionId: string, completedAt: string, seconds: number): SessionCompletion {
  return { sessionId, completedAt, seconds };
}

describe('totalMinutes', () => {
  it('returns 0 for no completions', () => {
    expect(totalMinutes([])).toBe(0);
  });

  it('floors the summed seconds to whole minutes (90 s + 45 s = 2 min)', () => {
    const c = [
      completion('a', '2026-10-18T10:00:00', 90),
      completion('b', '2026-10-18T11:00:00', 45),
    ];
    expect(totalMinutes(c)).toBe(2);
  });
});

describe('sessionsCompleted', () => {
  it('returns 0 for no completions', () => {
    expect(sessionsCompleted([])).toBe(0);
  });

  it('counts every completion, including repeats on the same day', () => {
    const c = [
      completion('a', '2026-10-18T10:00:00', 60),
      completion('a', '2026-10-18T11:00:00', 60),
      completion('b', '2026-10-17T11:00:00', 60),
    ];
    expect(sessionsCompleted(c)).toBe(3);
  });
});

describe('currentStreak', () => {
  const today = new Date('2026-10-18T12:00:00');

  it('returns 0 for no completions', () => {
    expect(currentStreak([], today)).toBe(0);
  });

  it('counts today and yesterday as a streak of 2', () => {
    const c = [
      completion('a', '2026-10-18T09:00:00', 60),
      completion('b', '2026-10-17T09:00:00', 60),
    ];
    expect(currentStreak(c, today)).toBe(2);
  });

  it('counts only yesterday as a streak of 1 when today has none', () => {
    const c = [completion('a', '2026-10-17T09:00:00', 60)];
    expect(currentStreak(c, today)).toBe(1);
  });

  it('counts only the most recent run when there is a gap of a day', () => {
    const c = [
      completion('a', '2026-10-18T09:00:00', 60), // today
      completion('b', '2026-10-17T09:00:00', 60), // yesterday
      // 2026-10-16 missing
      completion('c', '2026-10-15T09:00:00', 60),
      completion('d', '2026-10-14T09:00:00', 60),
    ];
    expect(currentStreak(c, today)).toBe(2);
  });

  it('returns 0 when the most recent completion is older than yesterday', () => {
    const c = [completion('a', '2026-10-16T09:00:00', 60)];
    expect(currentStreak(c, today)).toBe(0);
  });

  it('counts two completions on the same day once', () => {
    const c = [
      completion('a', '2026-10-18T08:00:00', 60),
      completion('b', '2026-10-18T20:00:00', 60),
    ];
    expect(currentStreak(c, today)).toBe(1);
  });

  it('counts a 23:30 completion and a 00:30 next-day completion as 2 days', () => {
    const c = [
      completion('a', '2026-10-17T23:30:00', 60),
      completion('b', '2026-10-18T00:30:00', 60),
    ];
    expect(currentStreak(c, today)).toBe(2);
  });
});

describe('isComplete', () => {
  it('is false just under 90% of the duration', () => {
    expect(isComplete(89, 100)).toBe(false);
  });

  it('is true at exactly 90% of the duration', () => {
    expect(isComplete(90, 100)).toBe(true);
  });

  it('is false when the duration is 0', () => {
    expect(isComplete(5, 0)).toBe(false);
  });
});
