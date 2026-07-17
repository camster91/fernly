// Domain types — what's stored, what's queried

export type Tone = 'soft' | 'direct' | 'playful';
export type Mascot = 'moon' | 'fox' | 'turtle' | 'bee';
export type Goal =
  | 'sleep'
  | 'quiet_thoughts'
  | 'less_anxious'
  | 'self_kindness'
  | 'process_feelings'
  | 'build_habit'
  | 'just_explore';

export type MoodScore = 1 | 2 | 3 | 4 | 5 | 6;

export interface UserProfile {
  name: string;
  mascot: Mascot;
  tone: Tone;
  goals: Goal[];
  onboarded: boolean;
  createdAt: string;
}

export interface MoodEntry {
  date: string; // ISO yyyy-mm-dd
  score: MoodScore;
  word?: string; // optional one-word tag
  note?: string;
}

export interface ExerciseSession {
  id: string;
  exerciseId: string;
  startedAt: string;
  completedAt?: string;
  data?: Record<string, unknown>; // exercise-specific input
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'fernly';
  text: string;
  at: string;
}

export interface ChatSession {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
}

export type ExerciseModality = 'CBT' | 'ACT' | 'GROUNDING' | 'BODY' | 'REFLECTION';

export interface ExerciseDef {
  id: string;
  title: string;
  modality: ExerciseModality;
  durationMin: number;
  emoji: string;
  blurb: string;
  description: string;
}
