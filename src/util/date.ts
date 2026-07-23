// Date utilities — local-date string helpers for mood history.
//
// Why this exists:
//   React Native's `new Date().toISOString()` returns a UTC timestamp.
//   Calling `.slice(0, 10)` on that gives the UTC date, which can be
//   off-by-one relative to the user's local calendar day:
//     - A PST user logging a mood at 11pm local on July 21 sees
//       '2026-07-22' (UTC) — their mood is filed under tomorrow.
//     - Streaks then look broken (yesterday has no log; today shows
//       the mood under a different key than the chart axis labels).
//     - East-of-UTC users can log a mood at 1am local on July 22 and
//       see it stored under '2026-07-21'.
//
// `localDateString(d)` returns the YYYY-MM-DD the user sees on their
// wall clock. All mood storage and streak math goes through this so
// the date matches what the user typed.
//
// `parseLocalDate(s)` parses a YYYY-MM-DD string back into a Date at
// local midnight (so callers can do day arithmetic without a UTC
// round-trip).

export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string into a Date at local midnight (00:00:00 of
 * that calendar day in the user's local timezone). Use this when you
 * need to do day arithmetic (`d.setDate(d.getDate() - 1)`) without a
 * UTC round-trip.
 *
 * Invalid input returns `null` rather than throwing — callers should
 * check the return value if the input source is untrusted.
 */
export function parseLocalDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  // Date constructor: month is 0-indexed.
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  // Round-trip check: if Date overflowed (e.g. 2026-02-31), the
  // constructed date's getMonth() won't match. Reject those.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}
