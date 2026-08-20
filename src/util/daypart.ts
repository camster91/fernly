// v0.10 (issue #66): daypart-based greeting + check-in copy.
//
// The screen's greeting composition used to read "Good
// morning" (or "Hey afternoon" / "Wind-down time" / "Still
// up?") and compose a second sentence that prefixed the same
// noun with "Good" again — producing "Good good morning,
// name." on the h1. The fallback check-in prompt was a
// single morning phrase ("How are you waking up today?")
// rendered at every hour, including 9pm.
//
// The daypart function returns the noun, the eyebrow label,
// and a daypart-appropriate check-in prompt so each surface
// composes the copy it actually wants. Lives in util/ so
// the test file can import it without crossing into a .tsx
// (vitest runs in Node, no JSX loader by default).
export interface Daypart {
  /** Lowercase noun used in the h1: "Good morning, name." */
  noun: string;
  /** Uppercase label used in the eyebrow: "MORNING · 7-DAY STREAK". */
  label: string;
  /** Daypart-appropriate check-in prompt. */
  checkInPrompt: string;
}

export function daypartForHour(h: number): Daypart {
  if (h < 5) {
    return {
      noun: 'night',
      label: 'LATE NIGHT',
      checkInPrompt: "How's your night going?",
    };
  }
  if (h < 12) {
    return {
      noun: 'morning',
      label: 'MORNING',
      checkInPrompt: 'How are you waking up today?',
    };
  }
  if (h < 17) {
    return {
      noun: 'afternoon',
      label: 'AFTERNOON',
      checkInPrompt: 'How is the afternoon landing?',
    };
  }
  if (h < 21) {
    return {
      noun: 'evening',
      label: 'EVENING',
      checkInPrompt: 'How is the evening sitting with you?',
    };
  }
  return {
    noun: 'wind-down',
    label: 'WIND-DOWN',
    checkInPrompt: 'Ready to wind down?',
  };
}
