// 8 exercises for v0. Real CBT/ACT scripts live in fernly-spec — these are
// the metadata + simple stub flows. Each exercise has its own Screen.

import type { ExerciseDef } from '../types';

export const exercises: ExerciseDef[] = [
  {
    id: 'thought-record',
    title: 'Thought record',
    modality: 'CBT',
    durationMin: 5,
    emoji: '📝',
    blurb: 'Catch, examine, reframe one thought',
    description:
      'A classic CBT exercise. Notice a hot thought, find the distortion, write a reframe.',
  },
  {
    id: 'box-breathing',
    title: 'Box breathing',
    modality: 'BODY',
    durationMin: 4,
    emoji: '🌬',
    blurb: '4-4-4-4 to calm your nervous system',
    description: 'Inhale 4 · Hold 4 · Exhale 4 · Hold 4. Repeat for 4 minutes.',
  },
  {
    id: 'defusion',
    title: 'Defusion',
    modality: 'ACT',
    durationMin: 3,
    emoji: '🌊',
    blurb: '"I\'m having the thought that…" — unhook from it',
    description:
      'Notice a sticky thought. Add "I\'m having the thought that…" in front. Watch it become an object.',
  },
  {
    id: 'values-sort',
    title: 'Values sort',
    modality: 'ACT',
    durationMin: 6,
    emoji: '🧭',
    blurb: 'Pick 3 values guiding your choices this month',
    description: 'From a list of 8 values, pick the 3 you want steering this month.',
  },
  {
    id: 'grounding-54321',
    title: '5-4-3-2-1 grounding',
    modality: 'GROUNDING',
    durationMin: 3,
    emoji: '🌿',
    blurb: '5 things you see, 4 you touch, 3 you hear…',
    description: 'A sensory anchor for when your head is spinning.',
  },
  {
    id: 'self-compassion',
    title: 'Self-compassion break',
    modality: 'REFLECTION',
    durationMin: 4,
    emoji: '🤍',
    blurb: 'A 3-step Kristin Neff reset',
    description: 'Mindfulness · Common humanity · Self-kindness. Three short prompts.',
  },
  {
    id: 'worry-postpone',
    title: 'Worry postponement',
    modality: 'CBT',
    durationMin: 3,
    emoji: '⏸',
    blurb: 'Name the worry, park it for later',
    description:
      'When worry shows up uninvited, give it a scheduled slot — usually it shrinks by then.',
  },
  {
    id: 'body-scan',
    title: 'Bedtime body scan',
    modality: 'BODY',
    durationMin: 7,
    emoji: '🌙',
    blurb: 'Notice and release, head to toe',
    description: 'Slow guided attention from forehead to feet. Good before sleep.',
  },
];

export function getExercise(id: string): ExerciseDef | undefined {
  return exercises.find((e) => e.id === id);
}
