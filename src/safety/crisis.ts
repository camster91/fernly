// Crisis detection — first line of defense.
//
// Layers:
//   1. Keyword match (deterministic, instant). Catches explicit ideation.
//   2. Soft-signal flag (logged to profile, NOT blocking). For pattern tracking.
//   3. Optional: a tiny classifier LLM call for ambiguous cases. NOT included
//      in v0 because it adds latency + cost to every message. Add in v1 when
//      we have volume to tune false-positive rate.
//
// SAFETY RULE: when layer 1 fires, the LLM NEVER sees the message. The modal
// wins unconditionally. This is the one place in the codebase where we MUST
// not let the AI have a say.

export type CrisisLevel = 'none' | 'soft' | 'hard';

interface CrisisVerdict {
  level: CrisisLevel;
  matchedPhrase?: string;
}

// Strong signals — block at modal level. Phrases chosen to minimize false
// positives while catching the common patterns in the wellness category
// (where users often write in lowercase, no punctuation, fragments).
const HARD_PATTERNS: RegExp[] = [
  /\b(kill|end|take)\s+(my\s*self|my\s*life|it\s+all)\b/i,
  /\b(want|wanted|wanna|planning|plan)\s+to\s+(die|kill\s+(my\s*self|myself))\b/i,
  /\bsuicide\b/i,
  /\bsuicidal\b/i,
  /\bcut\s+(my\s*self|myself)\b/i,
  /\bhurt\s+(my\s*self|myself)\b/i,
  /\boverdose\b/i,
  /\bdon['’]?t\s+want\s+to\s+(live|be\s+alive|exist)\b/i,
  /\bcan['’]?t\s+(go\s+on|do\s+this\s+anymore|take\s+(it|this)\s+anymore)\b/i,
];

// Soft signals — log only, don't intercept. Patterns that *might* indicate
// crisis but in everyday speech are usually just venting.
const SOFT_PATTERNS: RegExp[] = [
  /\bgive\s+up\b/i,
  /\bno\s+(point|hope)\b/i,
  /\bbetter\s+off\s+(without|if\s+i\s+wasn['’]?t)\b/i,
  /\bwhat['’]?s\s+the\s+point\b/i,
  /\bempty\s+inside\b/i,
  /\bnumb(er|ing)\s+(me|out)\b/i,
  /\bdon['’]?t\s+care\s+(anymore|about\s+anything)\b/i,
];

// False-positive guard: words/phrases that LOOK like crisis but are not.
// Used to suppress matches.
const CONTEXT_OVERRIDES: RegExp[] = [
  /\b(kill(ed|s|ing)?\s+it|killed\s+it)\b/i,                  // "I killed it" (gaming, work)
  /\b(die\s+laughing|dying\s+of\s+laughter)\b/i,
  /\b(want\s+to\s+die\s+laughing)\b/i,
  /\b(just\s+exhausted|so\s+tired)\b/i,
];

export function detectCrisis(input: string): CrisisVerdict {
  const text = input.trim();
  if (!text) return { level: 'none' };

  // 1. False-positive guard — if the message is clearly not crisis, bail early
  for (const re of CONTEXT_OVERRIDES) {
    if (re.test(text)) return { level: 'none' };
  }

  // 2. Hard patterns — modal wins
  for (const re of HARD_PATTERNS) {
    const m = text.match(re);
    if (m) return { level: 'hard', matchedPhrase: m[0] };
  }

  // 3. Soft patterns — flag only
  for (const re of SOFT_PATTERNS) {
    const m = text.match(re);
    if (m) return { level: 'soft', matchedPhrase: m[0] };
  }

  return { level: 'none' };
}

// Resources by locale. v0: US only. v1: international via locale detection.
// Source: 988 Suicide & Crisis Lifeline, findahelpline.com.
export interface CrisisResource {
  name: string;
  phone?: string;
  text?: string;
  url?: string;
}

export function crisisResourcesFor(locale: string = 'en-US'): CrisisResource[] {
  if (locale.startsWith('en-US') || locale === 'en') {
    return [
      { name: '988 Suicide & Crisis Lifeline (US)', phone: '988' },
      { name: 'Crisis Text Line (US)', text: 'HOME to 741741' },
      { name: 'Find a helpline worldwide', url: 'https://findahelpline.com' },
    ];
  }
  if (locale.startsWith('en-GB')) {
    return [
      { name: 'Samaritans (UK)', phone: '116 123' },
      { name: 'Find a helpline worldwide', url: 'https://findahelpline.com' },
    ];
  }
  // Fallback
  return [
    { name: 'Find a helpline worldwide', url: 'https://findahelpline.com' },
  ];
}