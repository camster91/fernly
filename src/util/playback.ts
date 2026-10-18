// Pure helpers for the audio player screen. No React Native imports.

import { isComplete } from './progress';

/** Format seconds as m:ss. NaN, Infinity and negatives render as 0:00. */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const whole = Math.floor(sec);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export interface CompletionStep {
  /** True exactly when a completion should be written now. */
  record: boolean;
  /** New value for the "already recorded for this play-through" flag. */
  recorded: boolean;
}

/**
 * Decide whether a status tick should record a completion.
 *
 * - Records once when position reaches 90% of duration (isComplete).
 * - Further ticks in the same play-through do not re-record.
 * - Restarting from under 10% re-arms, so a replay can record again.
 * - Nothing here fires on unmount, so leaving early records nothing.
 */
export function nextCompletionState(
  recorded: boolean,
  positionSec: number,
  durationSec: number,
): CompletionStep {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return { record: false, recorded };
  if (recorded) {
    return { record: false, recorded: positionSec >= 0.1 * durationSec };
  }
  if (isComplete(positionSec, durationSec)) return { record: true, recorded: true };
  return { record: false, recorded: false };
}
