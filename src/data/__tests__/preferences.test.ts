// v0.10 (issue #76): tests for the consolidated preference
// metadata. The arrays in this module are the SINGLE source
// of truth for the available Mascots / Tones / Goals / Moods;
// OnboardingScreen and SettingsScreen both import from
// here. Adding a new option is a one-line change in this
// file rather than two parallel changes in two screens.

import { describe, expect, it } from 'vitest';
import {
  GOALS,
  MASCOTS,
  MOOD_CHOICES,
  TONES,
  goalById,
  moodById,
  toneById,
} from '../preferences';

describe('preferences metadata (issue #76)', () => {
  describe('MASCOTS', () => {
    it('has unique ids', () => {
      const ids = MASCOTS.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every mascot has a non-empty emoji', () => {
      for (const m of MASCOTS) {
        expect(m.emoji.length).toBeGreaterThan(0);
      }
    });
  });

  describe('TONES', () => {
    it('has unique ids', () => {
      const ids = TONES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every tone has both label variants + both sample variants', () => {
      for (const t of TONES) {
        expect(t.label.length).toBeGreaterThan(0);
        expect(t.onboardingLabel.length).toBeGreaterThan(0);
        expect(t.sample.length).toBeGreaterThan(0);
        expect(t.onboardingSample.length).toBeGreaterThan(0);
        expect(t.bg.length).toBeGreaterThan(0);
      }
    });

    it('onboarding label contains the plain label (emoji prefix)', () => {
      for (const t of TONES) {
        // The onboarding label is the plain label with an emoji
        // prepended. Stripping the emoji character should yield
        // the plain label.
        const stripped = t.onboardingLabel.replace(/[^\w\s']/g, '').trim();
        expect(stripped.toLowerCase()).toContain(t.label.toLowerCase());
      }
    });
  });

  describe('GOALS', () => {
    it('has unique ids', () => {
      const ids = GOALS.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every goal has both label variants', () => {
      for (const g of GOALS) {
        expect(g.label.length).toBeGreaterThan(0);
        expect(g.onboardingLabel.length).toBeGreaterThan(0);
      }
    });
  });

  describe('MOOD_CHOICES', () => {
    it('has unique ids', () => {
      const ids = MOOD_CHOICES.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every mood has a non-empty label and a 1-6 score', () => {
      for (const m of MOOD_CHOICES) {
        expect(m.text.length).toBeGreaterThan(0);
        expect(m.score).toBeGreaterThanOrEqual(1);
        expect(m.score).toBeLessThanOrEqual(6);
      }
    });

    it('score is the canonical key for the rest of the app', () => {
      // The whole point of issue #80: distinct labels must be
      // able to share a score (Anxious / Tired / Overwhelmed /
      // Lonely all map to 2). The data confirms this — the
      // round-trip is via id, not via score.
      const score2Labels = MOOD_CHOICES.filter((m) => m.score === 2).map(
        (m) => m.text,
      );
      expect(score2Labels.length).toBeGreaterThan(1);
    });
  });

  describe('lookup helpers', () => {
    it('moodById returns the matching entry', () => {
      expect(moodById('anxious')?.text).toBe('Anxious');
      expect(moodById('hopeful')?.score).toBe(5);
    });

    it('moodById returns null for an unknown id', () => {
      expect(moodById('not-a-mood' as never)).toBeNull();
    });

    it('goalById returns the matching entry', () => {
      expect(goalById('sleep')?.label).toBe('Sleep better');
      expect(goalById('sleep')?.onboardingLabel).toContain('Sleep');
    });

    it('toneById returns the matching entry', () => {
      expect(toneById('soft')?.label).toBe('Soft');
      expect(toneById('soft')?.bg.length).toBeGreaterThan(0);
    });
  });
});
