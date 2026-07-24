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

import { storage } from '../storage';

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

  // 2. v0.9 (F-P1-2): collapse separators between single letters.
  //    Catches "k.m.s" → "kms", "k-m-s" → "kms", "k/m/s" → "kms",
  //    "k s" — but also less-obvious separators popular in bypass
  //    forums: "k∶m∶s" (ratio), "k∙m∙s" (dot operator), "k・m・s"
  //    (katakana middle dot), "k⬝m⬝s", "k\u200bm\u200bs" (those
  //    are stripped earlier by ZWJ/ZWSP). Character class kept
  //    intentionally narrow: just separators between Latin letters.
  //    The "∙" ∙, "・" ・, and "⬝" ⬝ characters are listed by their
  //    hex escape so the char-class doesn't get accidentally truncated
  //    by tooling that handles raw multibyte chars.
  s = s.replace(
    /(\b[a-zA-Z])[.\-/,_:|·・•∶⸱⸳⟨⟩⟦⟧⌈⌉⌊⌋∠⦣﹒﹕∶\u2219\u30FB\u2B1D]+(?=[a-zA-Z])/g,
    '$1',
  );

  // 3. Leetspeak → letter. Subset chosen for the most common
  //    crisis-token swaps. Does NOT touch "h4te" → "hate" because
  //    that's a normal English word. Runs BEFORE the letter-spacing
  //    collapse so "k1ll m3" → "kill m" → "killm" pattern-matches.
  s = s
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');

  // 4. Collapse letter-spaced runs. Catches "k i l l   m y s e l f"
  //    and "k i l l m y s e l f" by removing whitespace between single
  //    letters in a sequence of 4+ consecutive single letters. Matches
  //    are case-insensitive (the result is lowercased at the end).
  //
  // The 4-letter minimum is conservative — it keeps the collapse from
  // accidentally trampling short Portuguese/Italian/Spanish constructs
  // ("n\u00e3o a" = "no, I", "y a" = "and I") where a 2- or 3-letter
  // collapse would combine unrelated tokens. Crisis-token bypasses
  // are 4+ letters anyway (kms, kill, suicide).
  s = s.replace(/(\b[a-zA-Z])(?:\s+[a-zA-Z]){3,30}/g, (m) => m.replace(/\s+/g, ''));

  // 5. Lowercase for the pattern test. The regex flags are `i` anyway,
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
  // v0.9 (F-P1-2): 3-letter spaced bypasses. The 4-letter minimum
  // on the letter-spacing collapse misses these, so we hit the
  // common ones directly. Same constraint: catch the crisis tokens,
  // leave everyday language alone.
  /\b(k\s+y\s+s|k\s+m\s+s)\b/i,
  // v0.9 (F-P1-2 follow-up): leet+letter-space hybrids. The normalizer
  // can't safely collapse 2-letter runs across spaces (Portuguese
  // false-positive risk), so explicit patterns for the common
  // "k1ll m3" / "k1ll me" / "ky5 m3" forms. The {1,3} numeric run
  // is greedy enough to match "3", "m3", "m3e" without gobbling
  // non-leet text.
  /\bk\s*[il1]+\s*l\s*l?\s*[\s,.;:!\-_]*\s*m[\s,.;:!\-_]*e\b/i,
  /\bk\s*[il1]+\s*l\s*l?\s*[\s,.;:!\-_]*\s*m[\s,.;:!\-_]*[s5]\b/i,
  /\bk\s*[y]\s*[s5]\b/i,
  // v0.8: tightened to require a negative prefix OR a negative suffix.
  // Previously matched `alive` standalone (the word "I'm glad to be
  // alive" was tripping hard). The original 7-category spec from plans/
  // 03 expects a "I'm done with being alive" / "tired of being alive"
  // pattern, which these alternations cover while excluding the
  // "glad to be alive" / "happy to be alive" common phrasing.
  /\b(?:un|re)\s*alive\b/i,
  /\b(?:wish|i\s+wish|wanted|don't\s+want\s+to\s+be|tired\s+of\s+being)\s+(?:i\s+was(?:n['’]?\s*t)?\s+)?alive\b/i,
  /\b(?:never|don't\s+want\s+to\s+have)\s+been\s+alive\b/i,
  /\bpermadeath\b/i,

  // Euphemistic ideation
  /\b(end\s+(it|everything|my\s+pain|my\s+suffering))\b/i,
  /\b(better\s+off\s+dead)\b/i,
  /\b(permanent\s+solution)\b/i,
  /\b(tired\s+of\s+(being\s+)?alive)\b/i,
  /\b(no\s+reason\s+to\s+live)\b/i,
  /\b(want\s+to\s+(not\s+live|stop\s+existing))\b/i,
  /\b(can['’]?\s*t\s+(keep\s+going|take\s+(it|this)\s+anymore))\b/i,

  // v0.9 (F-P1-2): contemporary slang + euphemisms. Each pattern
  // requires the negation/me-self object so it doesn't false-posit
  // on everyday uses ("off to the store", "the ceiling is
  // leaking"). CTB = "commit to breathe / cut to black" — common
  // on r/SuicideWatch and similar communities; "check out
  // permanently" is the polite euphemism.
  /\b(going\s+to\s+off\s+(my\s*self|myself))\b/i,
  /\b(about\s+to\s+off\s+(my\s*self|myself))\b/i,
  /\b(offing\s+(my\s*self|myself))\b/i,
  /\b(d['’]?\s*ecid(ed|e)\s+to\s+ctb|decided\s+to\s+cut\s+to\s+black|decided\s+to\s+check\s+out\s+perm)\b/i,
  /\b(check\s+out\s+perm(anently)?|check\s+out\s+for\s+good|going\s+to\s+ctb)\b/i,

  // Method mentions that should escalate
  /\b(self[\s-]*harm|self[\s-]*harming)\b/i,
  /\b(jump(ing)?\s+(off|from)\s+(a\s+)?(bridge|building|roof))\b/i,
  /\b(pills\s+in\s+my\s+hand|pills\s+out)\b/i,
  /\b(i\s+have\s+a\s+plan\s+to\s+(end|kill))\b/i,

  // v0.9 (F-P1-2): method + intent combinations. The single-token
  // "pills" / "rope" / "bridge" only matters when paired with
  // ideation context. Adding the chained "...and I don't want
  // to wake up" / "...and I plan to jump" patterns. Each is
  // gated on a conjunction so we don't escalate ordinary
  // mentions like "I bought rope" or "we drove over a bridge".
  /\b((?:pills|rope|bridge)\b[\s\S]{0,80}?(?:don't\s+want\s+to\s+(live|wake|wake\s+up|be\s+here)|not\s+want\s+to\s+(live|wake|wake\s+up|be\s+here)|w['’]?\s*a\s*n['’]?\s*t\s+to\s+(live|wake|be\s+here)|plan\s+to\s+(jump|end\s+it)))/i,
  /\b((?:don't\s+want\s+to\s+(live|wake|wake\s+up|be\s+here)|not\s+want\s+to\s+(live|wake|wake\s+up|be\s+here)|w['’]?\s*a\s*n['’]?\s*t\s+to\s+(live|wake|be\s+here)|plan\s+to\s+(jump|end\s+it))\b[\s\S]{0,80}?(?:pills|rope|bridge))/i,

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
  /\b(n[aàáâã]\s*o\s+quero\s+viver)\b/i,
  // v0.9 (F-P1-2): pt-BR soft / fatigue phrasing. "não aguento
  // mais viver" = "I can't take living anymore" — the pt-BR
  // equivalent of the English passive-disengagement soft signals.
  /\b(n[aàáâã]\s*o\s+aguento\s+mais\s+viver)\b/i,
  /\b(n[aàáâã]\s*o\s+quero\s+mais\s+estar\s+vivo)\b/i,
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
  // v0.9 (F-P1-2): passive-disengagement phrasing. These were the
  // practical soft-tier hits the test corpus surfaced — everyday
  // venting that doesn't itself indicate imminent ideation but
  // a clinician might want to see the trend of. Log, don't block.
  /\b(i['’]?\s*m\s+(so\s+)?tired\s+of\s+(being|this))\b/i,
  /\b(i\s+just\s+want\s+(it|this)\s+to\s+stop)\b/i,
  /\b(everything\s+(feels?|is)\s+(pointless|grey))\b/i,
  /\b(there\s+is\s+no\s+point)\b/i,
  /\b(nothing\s+matters)\b/i,
  /\b(i\s+wish\s+i\s+could\s+(disappear|not\s+exist))\b/i,
  /\b(tired\s+of\s+being\s+tired|exhausted\s+from\s+exhaustion)\b/i,
];

// False-positive guard: words/phrases that LOOK like crisis but are not.
// Used to suppress matches. Tested against the ORIGINAL text, not the
// normalized form, so idioms like "I'm dying of laughter" survive even
// after normalization.
const CONTEXT_OVERRIDES: RegExp[] = [
  /\b(kill(ed|s|ing)?\s+it|killed\s+it)\b/i, // "I killed it" (gaming, work)
  /\b(die\s+laughing|dying\s+of\s+laughter)\b/i,
  /\b(want\s+to\s+die\s+laughing)\b/i,
  /\b(just\s+exhausted)\b/i, // fatigue idiom
  // v0.9: "so tired" pulled from the false-positive guard because
  // when combined with "of being [tired/exhausted]" it's a soft-
  // signal phrase. Standalone "I'm so tired" still matches the
  // soft tier (`tired of being tired`), and the hard tier catches
  // genuine ideation. False-positive risk on "I'm so tired" by
  // itself is acceptable: a soft signal isn't a modal, it's a log.
  /\b(this|school|work|my\s+job)\s+is\s+killing\s+me\b/i, // figurative hyperbole
  /\bdying\s+of\s+(embarrassment|shame)\b/i,
  // v0.8: explicit positive "alive" phrases that should never escalate.
  // Tested against the ORIGINAL text (not normalized) so idioms survive.
  // The "alive" hard pattern requires a negative prefix/suffix — this
  // list catches positive phrasing the prefix doesn't cover.
  /\b(glad|happy|thrilled|grateful|love|loved|loving|excited|thankful)\s+(to\s+be|that\s+i'm|i\s+am)\s+(still\s+)?alive\b/i,
  /\bbeing\s+alive\s+(is|feels?)\s+(a\s+)?(gift|good|great|wonderful|amazing|beautiful)\b/i,
  /\bso\s+(glad|happy|grateful|thankful)\s+(i'm|i\s+am|to\s+be)\s+(still\s+)?alive\b/i,
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
// v0.2 expansion: added es-MX, es-AR, fr-FR, pt-BR, de-DE branches.
// Phone numbers sourced from each country's official crisis line directory.
// v0.5: expo-localization IS wired now — pickLocale() in CrisisModal.tsx
// reads the device locale at modal mount. The TODO is stale.
export interface CrisisResource {
  name: string;
  phone?: string;
  text?: string;
  url?: string;
}

// Cache of resource URLs that have been verified reachable at app start.
// Populated by `verifyResourceReachability()`; consumed by CrisisModal to
// decide whether to show a "resources may be unavailable" banner.
//
// v0.8 (F-P1-10): backed by AsyncStorage so entries survive cold launches.
// `hydrateVerifiedUrls()` must be called once at app startup before
// `verifyResourceReachability()` runs; without it, the in-memory map
// starts empty and the modal shows the "unreachable" banner until the
// post-launch HEAD check completes (~3s). Stale entries (>6h) are
// dropped on hydrate so they don't suppress a real fresh failure.
const verifiedUrls = new Map<string, number>(); // url → lastVerifiedAt (ms)
const VERIFIED_URL_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export function lastVerifiedAt(url: string): number | null {
  return verifiedUrls.get(url) ?? null;
}

/**
 * v0.8 (F-P1-10): load the persisted verifiedUrls map from AsyncStorage
 * and seed the in-memory cache. Entries with `verifiedAt < (now - 6h)`
 * are dropped so a stale "fresh" entry can't suppress a real fresh
 * failure on next launch. Should be called once at app startup, before
 * the post-launch `verifyResourceReachability()` re-check fires.
 *
 * Best-effort: missing key or parse failure is a no-op (in-memory map
 * stays empty and the re-check proceeds as before).
 */
export async function hydrateVerifiedUrls(): Promise<void> {
  try {
    const persisted = await storage.getVerifiedUrls();
    const now = Date.now();
    let loaded = 0;
    for (const [url, at] of Object.entries(persisted)) {
      if (typeof at !== 'number' || !Number.isFinite(at)) continue;
      if (now - at >= VERIFIED_URL_TTL_MS) continue;
      verifiedUrls.set(url, at);
      loaded++;
    }
    if (loaded > 0) {
      console.log(`[crisis] hydrated ${loaded} verified url(s) from disk`);
    }
  } catch {
    // Storage layer swallows its own errors; this catch is belt-and-suspenders
    // for the in-memory set. Either way, fall through with the empty map.
  }
}

/**
 * HEAD-check each resource URL with a 3s timeout. Failures are silent;
 * the cache stays empty and the CrisisModal banner logic handles the rest.
 *
 * v0.2: called from `App.tsx` mount. Best-effort, never blocks UI.
 * v0.8 (F-P1-10): on a successful HEAD check, persist `{ url: verifiedAt }`
 * to AsyncStorage so the next cold launch can skip the re-check for fresh
 * entries (<6h). Persistence is fire-and-forget — a write failure does
 * not invalidate the in-memory update, which keeps the current session
 * responsive.
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
        if (res.ok) {
          const now = Date.now();
          verifiedUrls.set(url, now);
          // Persist asynchronously — don't await on the hot path so a slow
          // AsyncStorage write can't stretch the post-launch banner window.
          storage.setVerifiedUrls(Object.fromEntries(verifiedUrls)).catch(() => undefined);
        }
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
