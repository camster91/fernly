// Mascot → emoji mapping. Shared between ChatScreen and ProfileScreen so
// the empty-state fallback (when profile.mascot hasn't loaded yet, or is
// 'bee') stays consistent across the app. Onboarding defaults mascot to
// 'moon', so the chat empty-state should fall back to '🌙' (not '🐝').
import type { Mascot } from '../types';

export const MASCOT_EMOJI: Record<Mascot, string> = {
  moon: '🌙',
  fox: '🦊',
  turtle: '🐢',
  bee: '🐝',
};

export const MASCOT_EMOJI_FALLBACK = '🌙';
