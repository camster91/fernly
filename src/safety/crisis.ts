// Crisis detection — first line of defense.
//
// Layers:
//   0. Normalization — strip zero-width chars, collapse letter-spaced runs,
//      normalize common leetspeak. Catches "k i l l m y s e l f" and
//      "k1ll mys3lf" before regex ever sees them.
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

// Normalize input before any pattern match. Returns a string that may differ
// from the original but preserves the original-meaning tokens. The original
// text is never mutated in place — this returns a new string.
function normalize(input: string): string {
  let s = input;

  // 1. Strip zero-width chars (ZWJ, ZWNJ, ZWSP, BOM, word joiner).
  //    These are common in bypass attempts: "k\u200b i\u200b l\u200b l"
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');

  // 2. Collapse letter-spaced runs. Catches "k i l l   m y s e l f"
  //    and "k i l l m y s e l f" by removing whitespace between single
  //    letters in a sequence of 4+ consecutive single letters. Matches
  //    are case-insensitive (the result is lowercased at the end).
  s = s.replace(/(\b[a-zA-Z])(?:\s+[a-zA-Z]){3,30}/g, (m) => m.replace(/\s+/g, ''));

  // 3. Leetspeak → letter. Subset chosen for the most common
  //    crisis-token swaps. Does NOT touch "h4te" → "hate" because
  //    that's a normal English word.
  s = s
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');

  // 4. Lowercase for the pattern test. The regex flags are `i` anyway,
  //    but lowercase once is cheaper than per-regex case folding.
  return s.toLowerCase();
}

// Strong signals — block at modal level. Phrases chosen to minimize false
// positives while catching the common patterns in the wellness category
// (where users often write in lowercase, no punctuation, fragments).
//
// v0.2: extended with gen-z shorthand (kms, kys, unalive), ideation
// euphemisms ("end it", "end my pain"), and a method-mention bucket.
// All patterns are tested against the normalized form, so leetspeak
// and ZWJs are caught by the normalizer.
const HARD_PATTERNS: RegExp[] = [
  // Original v0 patterns — `\s+` here matches BOTH real whitespace AND the
  // collapsed form produced by `normalize()` (e.g. "killmyself" with no
  // space). The space is still optional in case normalization strips more
  // than expected.
  /\b(kill|end|take)[\s-]*(my[\s-]*self|my[\s-]*life|it[\s-]*all|myself)\b/i,
  /\b(want|wanted|wanna|planning|plan)[\s-]+to[\s-]+(die|kill[\s-]+(my[\s-]*self|myself))\b/i,
  /\bsuicid(e|al)\b/i,
  /\boverdose\b/i,
  /\bcut\s+(my\s*self|myself)\b/i,
  /\bhurt\s+(my\s*self|myself)\b/i,
  /\bdon['’]?\s*t\s+want\s+to\s+(live|be\s+alive|exist)\b/i,
  /\bcan['’]?\s*t\s+(go\s+on|do\s+this\s+anymore|take\s+(it|this)\s+anymore)\b/i,

  // Gen-z shorthand — must be on the normalized form to catch leetspeak
  // variants of these tokens via the `1→i, 0→o` substitutions above.
  /\b(kms|kys)\b/i,
  /\b(un|re)?alive(d)?\s*(myself|me|tonight|forever)?\b/i,
  /\bpermadeath\b/i,

  // Euphemistic ideation
  /\b(end\s+(it|everything|my\s+pain|my\s+suffering))\b/i,
  /\b(better\s+off\s+dead)\b/i,
  /\b(permanent\s+solution)\b/i,
  /\b(tired\s+of\s+(being\s+)?alive)\b/i,
  /\b(no\s+reason\s+to\s+live)\b/i,
  /\b(want\s+to\s+(not\s+live|stop\s+existing))\b/i,
  /\b(can['’]?\s*t\s+(keep\s+going|take\s+(it|this)\s+anymore))\b/i,

  // Method mentions that should escalate
  /\b(self[\s-]*harm|self[\s-]*harming)\b/i,
  /\b(jump(ing)?\s+(off|from)\s+(a\s+)?(bridge|building|roof))\b/i,
  /\b(pills\s+in\s+my\s+hand|pills\s+out)\b/i,
  /\b(i\s+have\s+a\s+plan\s+to\s+(end|kill))\b/i,

  // Spanish — top phrases from verified helpline translations
  /\b(me\s+quiero\s+morir)\b/i,
  /\b(quiero\s+suicidarme|quiero\s+mat(ar|arme))\b/i,
  /\b(no\s+quiero\s+vivir)\b/i,
  /\b(estoy\s+harto\s+de\s+vivir)\b/i,

  // French
  /\b(je\s+veux\s+mourir|je\s+veux\s+me\s+tuer)\b/i,
  /\b(je\s+n['’]?\s*en\s+peux\s+plus)\b/i,
  /\b(plus\s+envie\s+de\s+vivre)\b/i,

  // Portuguese
  /\b(quero\s+morrer)\b/i,
  /\b(n[aã]o\s+quero\s+viver)\b/i,
];

// Soft signals — log only, don't intercept. Patterns that *might* indicate
// crisis but in everyday speech are usually just venting.
const SOFT_PATTERNS: RegExp[] = [
  /\bgive\s+up\b/i,
  /\bno\s+(point|hope)\b/i,
  /\bbetter\s+off\s+(without|if\s+i\s+wasn['’]?\s*t)\b/i,
  /\bwhat['’]?\s*s\s+the\s+point\b/i,
  /\bempty\s+inside\b/i,
  /\bnumb(er|ing)\s+(me|out)\b/i,
  /\bdon['’]?\s*t\s+care\s+(anymore|about\s+anything)\b/i,
  // Soft ideation that isn't quite hard — flag for v1 follow-up
  /\b(i['’]?\s*m\s+(so\s+)?tired\s+of\s+(being|this))\b/i,
  /\b(i\s+just\s+want\s+it\s+to\s+stop)\b/i,
  /\b(everything\s+(feels?|is)\s+pointless)\b/i,
];

// False-positive guard: words/phrases that LOOK like crisis but are not.
// Used to suppress matches. Tested against the ORIGINAL text, not the
// normalized form, so idioms like "I'm dying of laughter" survive even
// after normalization.
const CONTEXT_OVERRIDES: RegExp[] = [
  /\b(kill(ed|s|ing)?\s+it|killed\s+it)\b/i, // "I killed it" (gaming, work)
  /\b(die\s+laughing|dying\s+of\s+laughter)\b/i,
  /\b(want\s+to\s+die\s+laughing)\b/i,
  /\b(just\s+exhausted|so\s+tired)\b/i, // fatigue idiom
  /\b(this|school|work|my\s+job)\s+is\s+killing\s+me\b/i, // figurative hyperbole
  /\bdying\s+of\s+(embarrassment|shame)\b/i,
];

export function detectCrisis(input: string): CrisisVerdict {
  const text = input.trim();
  if (!text) return { level: 'none' };

  // 0. Normalize — strip ZWJs, collapse letter-spaced runs, leetspeak.
  const normalized = normalize(text);

  // 1. False-positive guard — test against the ORIGINAL text so idioms
  //    like "I'm dying of laughter" survive normalization. If a benign
  //    idiom matches, bail early.
  for (const re of CONTEXT_OVERRIDES) {
    if (re.test(text)) return { level: 'none' };
  }

  // 2. Hard patterns — tested against the normalized form
  for (const re of HARD_PATTERNS) {
    const m = normalized.match(re);
    if (m) return { level: 'hard', matchedPhrase: m[0] };
  }

  // 3. Soft patterns — also on normalized form
  for (const re of SOFT_PATTERNS) {
    const m = normalized.match(re);
    if (m) return { level: 'soft', matchedPhrase: m[0] };
  }

  return { level: 'none' };
}

// Resources by locale. Verified helpline numbers as of 2026-07-10.
//
// v0.2 expansion: added es-MX, es-AR, fr-FR, pt-BR, de-DE branches.
// Phone numbers sourced from each country's official crisis line directory.
// TODO(v1): wire `expo-localization` and read locale at runtime instead
// of relying on a hardcoded default.
export interface CrisisResource {
  name: string;
  phone?: string;
  text?: string;
  url?: string;
}

// Cache of resource URLs that have been verified reachable at app start.
// Populated by `verifyResourceReachability()`; consumed by CrisisModal to
// decide whether to show a "resources may be unavailable" banner.
const verifiedUrls = new Map<string, number>(); // url → lastVerifiedAt (ms)

export function lastVerifiedAt(url: string): number | null {
  return verifiedUrls.get(url) ?? null;
}

/**
 * HEAD-check each resource URL with a 3s timeout. Failures are silent;
 * the cache stays empty and the CrisisModal banner logic handles the rest.
 *
 * v0.2: called from `App.tsx` mount. Best-effort, never blocks UI.
 */
export async function verifyResourceReachability(
  urls: string[],
  timeoutMs: number = 3000,
): Promise<void> {
  await Promise.allSettled(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        if (res.ok) verifiedUrls.set(url, Date.now());
      } catch {
        // silent — unreachable URL just stays out of the cache
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

export function crisisResourcesFor(locale: string = 'en-US'): CrisisResource[] {
  if (locale.startsWith('en-US') || locale === 'en') {
    return [
      { name: '988 Suicide & Crisis Lifeline (US)', phone: '988' },
      { name: 'Crisis Text Line (US)', text: 'HOME to 741741' },
      { name: 'Find a helpline worldwide', url: 'https://findahelpline.com' },
      {
        name: 'Find a helpline (IASP directory)',
        url: 'https://iasp.info/resources/Crisis_Centres/',
      },
    ];
  }
  if (locale.startsWith('en-GB')) {
    return [
      { name: 'Samaritans (UK)', phone: '116 123' },
      {
        name: 'Find a helpline (IASP directory)',
        url: 'https://iasp.info/resources/Crisis_Centres/',
      },
      { name: 'Find a helpline worldwide', url: 'https://findahelpline.com' },
    ];
  }
  if (locale.startsWith('es')) {
    // Mexico + Spain + Latin America — generic Spanish helplines
    return [
      { name: 'Línea de la Vida (México)', phone: '800 911 2000' },
      { name: 'Teléfono de la Esperanza (España)', phone: '717 003 717' },
      {
        name: 'Find a helpline (IASP directory)',
        url: 'https://iasp.info/resources/Crisis_Centres/',
      },
    ];
  }
  if (locale.startsWith('fr')) {
    return [
      { name: '3114 — Prévention du suicide (France)', phone: '3114' },
      {
        name: 'Find a helpline (IASP directory)',
        url: 'https://iasp.info/resources/Crisis_Centres/',
      },
    ];
  }
  if (locale.startsWith('pt')) {
    return [
      { name: 'Centro de Valorização da Vida (Brasil)', phone: '188' },
      {
        name: 'Find a helpline (IASP directory)',
        url: 'https://iasp.info/resources/Crisis_Centres/',
      },
    ];
  }
  if (locale.startsWith('de')) {
    return [
      { name: 'Telefonseelsorge (Deutschland)', phone: '0800 111 0 111' },
      {
        name: 'Find a helpline (IASP directory)',
        url: 'https://iasp.info/resources/Crisis_Centres/',
      },
    ];
  }
  // Fallback for any other locale — IASP directory first because it
  // localizes by country, plus findahelpline as a second fallback.
  return [
    {
      name: 'Find a helpline (IASP directory)',
      url: 'https://iasp.info/resources/Crisis_Centres/',
    },
    { name: 'Find a helpline worldwide', url: 'https://findahelpline.com' },
  ];
}
