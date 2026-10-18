// Pure progress helpers for the meditation library.
//
// No React Native or storage imports: callers pass in the completion
// records and get numbers back. Day keys use the user's local calendar
// (via localDateString) so a session finished at 23:30 and another at
// 00:30 the next morning count as two different days.

import { localDateString } from './date';

export interface SessionCompletion {
  sessionId: string;
  /** ISO timestamp of when the session was completed. */
  completedAt: string;
  /** Seconds of meditation credited for this completion. */
  seconds: number;
}

/** Total meditation time, floored to whole minutes. */
export function totalMinutes(c: SessionCompletion[]): number {
  const seconds = c.reduce((sum, s) => sum + s.seconds, 0);
  return Math.floor(seconds / 60);
}

/** Number of completion records (repeat sessions count each time). */
export function sessionsCompleted(c: SessionCompletion[]): number {
  return c.length;
}

/**
 * Consecutive local days with at least one completion, counting back from
 * `today`. If today has no completion the streak may start yesterday, so a
 * streak is not broken until a full day passes without practice.
 */
export function currentStreak(c: SessionCompletion[], today: Date): number {
  const days = new Set<string>();
  for (const s of c) {
    const at = new Date(s.completedAt);
    if (Number.isNaN(at.getTime())) continue; // skip unparseable timestamps
    days.add(localDateString(at));
  }

  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(localDateString(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(localDateString(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(localDateString(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** A played session counts as complete once 90% of its duration has elapsed. */
export function isComplete(positionSec: number, durationSec: number): boolean {
  return durationSec > 0 && positionSec >= 0.9 * durationSec;
}
