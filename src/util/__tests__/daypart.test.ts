// v0.10 (issue #66): tests for the daypartForHour function
// that drives TodayScreen's greeting + check-in copy.
//
// The function is exported from src/util/daypart.ts; these
// tests pin:
//  - exact 5-daypart mapping (overnight, morning, afternoon,
//    evening, wind-down) per the product spec
//  - boundary-hour behavior (e.g. 4:59 is overnight, 5:00 is
//    morning) so a clock-tick doesn't flip the greeting
//  - daypart-aware check-in prompt doesn't leak morning
//    copy at 9pm

import { describe, expect, it } from 'vitest';
import { daypartForHour } from '../daypart';

describe('daypartForHour (issue #66)', () => {
  it('maps overnight hours (0-4) to night', () => {
    for (const h of [0, 1, 2, 3, 4]) {
      const d = daypartForHour(h);
      expect(d.noun).toBe('night');
      expect(d.label).toBe('LATE NIGHT');
      expect(d.checkInPrompt).toContain('night');
    }
  });

  it('maps morning hours (5-11) to morning', () => {
    for (const h of [5, 6, 9, 10, 11]) {
      const d = daypartForHour(h);
      expect(d.noun).toBe('morning');
      expect(d.label).toBe('MORNING');
    }
  });

  it('maps afternoon hours (12-16) to afternoon', () => {
    for (const h of [12, 13, 15, 16]) {
      const d = daypartForHour(h);
      expect(d.noun).toBe('afternoon');
      expect(d.label).toBe('AFTERNOON');
    }
  });

  it('maps evening hours (17-20) to evening', () => {
    for (const h of [17, 18, 19, 20]) {
      const d = daypartForHour(h);
      expect(d.noun).toBe('evening');
      expect(d.label).toBe('EVENING');
    }
  });

  it('maps wind-down hours (21-23) to wind-down', () => {
    for (const h of [21, 22, 23]) {
      const d = daypartForHour(h);
      expect(d.noun).toBe('wind-down');
      expect(d.label).toBe('WIND-DOWN');
    }
  });

  it('preserves boundary hours correctly (4 → night, 5 → morning)', () => {
    expect(daypartForHour(4).noun).toBe('night');
    expect(daypartForHour(5).noun).toBe('morning');
  });

  it('preserves boundary hours correctly (11 → morning, 12 → afternoon)', () => {
    expect(daypartForHour(11).noun).toBe('morning');
    expect(daypartForHour(12).noun).toBe('afternoon');
  });

  it('preserves boundary hours correctly (16 → afternoon, 17 → evening)', () => {
    expect(daypartForHour(16).noun).toBe('afternoon');
    expect(daypartForHour(17).noun).toBe('evening');
  });

  it('preserves boundary hours correctly (20 → evening, 21 → wind-down)', () => {
    expect(daypartForHour(20).noun).toBe('evening');
    expect(daypartForHour(21).noun).toBe('wind-down');
  });

  it('does not leak morning copy in the evening check-in prompt', () => {
    // Pre-fix: the fallback prompt was "How are you waking up today?"
    // at every hour. Post-fix: each daypart gets its own prompt,
    // and the overnight prompt is daypart-appropriate.
    const morning = daypartForHour(7);
    const evening = daypartForHour(19);
    expect(morning.checkInPrompt).toContain('waking');
    expect(evening.checkInPrompt).not.toContain('waking');
  });

  it('h1 composition produces a grammatical sentence (issue #66 #h1 fix)', () => {
    // The h1 line is "Good {noun}, {name}." — verify the noun
    // doesn't already start with "Good" so the sentence doesn't
    // become "Good good morning, name."
    for (let h = 0; h < 24; h++) {
      const d = daypartForHour(h);
      expect(d.noun.startsWith('Good')).toBe(false);
    }
  });
});
