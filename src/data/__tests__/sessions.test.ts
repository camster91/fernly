import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickTodaySession, sessions } from '../sessions';

const root = join(__dirname, '..', '..', '..');
const ids = sessions.map((s) => s.id);

describe('session catalog', () => {
  it('ids are unique and kebab-case', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('has 12 sessions: 4 meditate, 3 sleep, 3 sos, 2 course', () => {
    const count = (c: string) => sessions.filter((s) => s.category === c).length;
    expect(sessions).toHaveLength(12);
    expect(count('meditate')).toBe(4);
    expect(count('sleep')).toBe(3);
    expect(count('sos')).toBe(3);
    expect(count('course')).toBe(2);
  });

  it('basics parts are ordered 1..2', () => {
    const course = sessions
      .filter((s) => s.category === 'course')
      .sort((a, b) => (a.courseOrder ?? 0) - (b.courseOrder ?? 0));
    expect(course.map((s) => s.courseOrder)).toEqual([1, 2]);
    expect(course.every((s) => s.courseId === 'basics')).toBe(true);
  });

  it('every session has a script and every script has a session', () => {
    const scripts = readdirSync(join(root, 'content', 'scripts'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
    expect(new Set(scripts)).toEqual(new Set(ids));
  });

  it('every session has an audio file', () => {
    for (const id of ids) {
      expect(existsSync(join(root, 'assets', 'audio', `${id}.m4a`))).toBe(true);
    }
  });

  it('sessionAudio has exactly the catalog ids', () => {
    const text = readFileSync(join(root, 'src', 'data', 'sessionAudio.ts'), 'utf8');
    const re = /'([a-z0-9-]+)':\s*require\('..\/..\/assets\/audio\/\1\.m4a'\)/g;
    const found = [...text.matchAll(re)].map((m) => m[1]);
    expect(new Set(found)).toEqual(new Set(ids));
    expect(found).toHaveLength(ids.length);
  });

  it('durationSec is positive', () => {
    for (const s of sessions) expect(s.durationSec).toBeGreaterThan(0);
  });

  it('sos sessions are <= 180s', () => {
    for (const s of sessions.filter((x) => x.category === 'sos')) {
      expect(s.durationSec).toBeLessThanOrEqual(180);
    }
  });
});

describe('pickTodaySession', () => {
  it('returns a meditate session', () => {
    expect(pickTodaySession(new Date(2026, 9, 18)).category).toBe('meditate');
  });

  it('is stable for the same date, regardless of time of day', () => {
    const a = pickTodaySession(new Date(2026, 9, 18, 0, 5));
    const b = pickTodaySession(new Date(2026, 9, 18, 23, 55));
    expect(a.id).toBe(b.id);
  });

  it('rotates on consecutive days', () => {
    const picks = [0, 1, 2, 3, 4].map((i) => pickTodaySession(new Date(2026, 0, 1 + i)).id);
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    expect(picks[0]).toBe(sessions.filter((s) => s.category === 'meditate')[0].id);
  });
});
