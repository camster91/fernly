// Tests for src/util/playback.ts — pure player helpers.
import { describe, expect, it } from 'vitest';
import { formatClock, nextCompletionState } from '../playback';

describe('formatClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(65.9)).toBe('1:05');
  });
  it('treats NaN, Infinity and negatives as 0:00', () => {
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
  });
});

describe('nextCompletionState', () => {
  const D = 100;
  it('does not record before 90%', () => {
    expect(nextCompletionState(false, 89, D)).toEqual({ record: false, recorded: false });
  });
  it('records once at >= 90% and not on repeated ticks', () => {
    const first = nextCompletionState(false, 90, D);
    expect(first).toEqual({ record: true, recorded: true });
    const again = nextCompletionState(first.recorded, 95, D);
    expect(again).toEqual({ record: false, recorded: true });
    expect(nextCompletionState(again.recorded, 100, D).record).toBe(false);
  });
  it('keeps recorded when scrubbing back to between 10% and 90%', () => {
    expect(nextCompletionState(true, 50, D)).toEqual({ record: false, recorded: true });
  });
  it('re-arms after restart from < 10%, allowing a second record', () => {
    const rearmed = nextCompletionState(true, 5, D);
    expect(rearmed).toEqual({ record: false, recorded: false });
    expect(nextCompletionState(rearmed.recorded, 92, D).record).toBe(true);
  });
  it('never records for unknown duration', () => {
    expect(nextCompletionState(false, 10, 0)).toEqual({ record: false, recorded: false });
    expect(nextCompletionState(false, 10, NaN).record).toBe(false);
  });
  it('leaving early (no ticks past 90%) records nothing', () => {
    let rec = false;
    let recorded = 0;
    for (const t of [0, 10, 30, 60, 85]) {
      const r = nextCompletionState(rec, t, D);
      rec = r.recorded;
      if (r.record) recorded += 1;
    }
    expect(recorded).toBe(0);
  });
});
