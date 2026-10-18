// Catalog of the free guided-meditation sessions. Pure data, no require() —
// safe to import in vitest. Audio lives in sessionAudio.ts.
// durationSec is the intended length; real durations replace it once the
// audio is generated.

export type SessionCategory = 'meditate' | 'sleep' | 'sos' | 'course';

export interface SessionDef {
  id: string;
  title: string;
  blurb: string;
  category: SessionCategory;
  durationSec: number;
  courseId?: 'basics';
  courseOrder?: number;
}

export const sessions: SessionDef[] = [
  {
    id: 'calm',
    title: 'Settle and Calm',
    blurb: 'Slow down and come back to your breath',
    category: 'meditate',
    durationSec: 600,
  },
  {
    id: 'focus',
    title: 'Clear Focus',
    blurb: 'Gather your attention before you begin',
    category: 'meditate',
    durationSec: 300,
  },
  {
    id: 'stress-reset',
    title: 'Stress Reset',
    blurb: 'Let the tension of the day ease off',
    category: 'meditate',
    durationSec: 480,
  },
  {
    id: 'gratitude',
    title: 'Gentle Gratitude',
    blurb: 'Notice the good things, big and small',
    category: 'meditate',
    durationSec: 300,
  },
  {
    id: 'sleep-body-scan',
    title: 'Sleepy Body Scan',
    blurb: 'Relax from head to toe and drift off',
    category: 'sleep',
    durationSec: 900,
  },
  {
    id: 'sleep-breath-count',
    title: 'Counting Breaths',
    blurb: 'A simple count to quiet a busy mind',
    category: 'sleep',
    durationSec: 720,
  },
  {
    id: 'sleep-let-go',
    title: 'Let the Day Go',
    blurb: 'Set down today and rest',
    category: 'sleep',
    durationSec: 600,
  },
  {
    id: 'sos-panic',
    title: 'Racing Heart',
    blurb: 'Slow things down when panic rises',
    category: 'sos',
    durationSec: 165,
  },
  {
    id: 'sos-anger',
    title: 'Cool Down',
    blurb: 'Take the heat out of a tense moment',
    category: 'sos',
    durationSec: 160,
  },
  {
    id: 'sos-overwhelm',
    title: 'Too Much',
    blurb: 'Ground yourself when everything piles up',
    category: 'sos',
    durationSec: 180,
  },
  {
    id: 'basics-1',
    title: 'Basics 1: Just Breathe',
    blurb: 'Your first meditation, step by step',
    category: 'course',
    durationSec: 300,
    courseId: 'basics',
    courseOrder: 1,
  },
  {
    id: 'basics-2',
    title: 'Basics 2: Wandering Minds',
    blurb: 'What to do when your mind drifts',
    category: 'course',
    durationSec: 300,
    courseId: 'basics',
    courseOrder: 2,
  },
];

export function sessionById(id: string): SessionDef | undefined {
  return sessions.find((s) => s.id === id);
}

export const CATEGORY_LABELS: Record<SessionCategory, string> = {
  meditate: 'Meditations',
  sleep: 'Sleep',
  sos: 'SOS',
  course: 'Basics course',
};
