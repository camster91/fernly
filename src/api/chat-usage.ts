// Chat usage limits — issue #41 acceptance criterion
// "Evaluation thresholds, prompt-change gates, failure behavior, and
// cost limits are enforced."
//
// This file owns the cost-limit half. The evaluation thresholds and
// prompt-change gates are enforced by the offline eval test set
// (scripts/eval-chat.test.ts); the failure behavior is the
// ChatBackendError.kind taxonomy in chat.ts.
//
// Two limits:
//   1. Per-minute burst — caps how many calls can fire in a 60s
//      window. A rapid double-tap (or a stuck UI) shouldn't
//      multiply into 50 requests to the LLM provider.
//   2. Per-day total — caps how many calls a single device can make
//      in a calendar day (local timezone). This is the
//      "cost spike" safety: even if the burst limit is somehow
//      bypassed, the daily cap bounds the worst case to a fixed
//      dollar amount.
//
// Both limits are evaluated BEFORE the network call (in
// reserveSlot()) so an over-limit request never reaches the wire.
// On a successful call, the slot is recorded; on a network failure
// AFTER the call started, the slot is NOT refunded — the cost was
// already incurred.
//
// Default limits (override in env if you really need to):
//   - BURST_LIMIT: 5 calls / minute
//   - DAILY_LIMIT: 200 calls / day
//
// The user can lower their own daily cap (privacy / cost concern)
// by editing the value via setDailyLimit(). Lowering the cap does
// NOT delete existing usage; it just narrows the headroom.

import { storage } from '../storage';

const DEFAULT_BURST_LIMIT = 5;
const DEFAULT_DAILY_LIMIT = 200;
const BURST_WINDOW_MS = 60_000; // 1 minute

export class ChatUsageLimitError extends Error {
  readonly limit: 'burst' | 'daily';
  readonly used: number;
  readonly cap: number;
  /** ms until the next slot frees (burst) or until local midnight (daily). */
  readonly resetMs: number;
  constructor(
    message: string,
    opts: {
      limit: 'burst' | 'daily';
      used: number;
      cap: number;
      resetMs: number;
    },
  ) {
    super(message);
    this.name = 'ChatUsageLimitError';
    this.limit = opts.limit;
    this.used = opts.used;
    this.cap = opts.cap;
    this.resetMs = opts.resetMs;
  }
}

interface ChatUsageState {
  /**
   * ISO yyyy-mm-dd in local time. The day rollover is detected by
   * comparing to "today"; if they differ, the counter resets.
   */
  dayKey: string;
  /** Count of successful calls in the current day. */
  dayCount: number;
  /**
   * Optional per-user daily cap override. null = use the default
   * (DEFAULT_DAILY_LIMIT). Set via setDailyLimit().
   */
  dailyCap: number | null;
  /**
   * Timestamps (ms epoch) of recent successful calls inside the
   * burst window. Trimmed to the last BURST_WINDOW_MS on every
   * read. Length is bounded by the burst cap, so this stays small.
   */
  burst: number[];
  /**
   * Schema version. Bump when the field shape changes.
   */
  version: 1;
}

const USAGE_VERSION = 1 as const;

function emptyState(now: Date = new Date()): ChatUsageState {
  return {
    dayKey: localDayKey(now),
    dayCount: 0,
    dailyCap: null,
    burst: [],
    version: USAGE_VERSION,
  };
}

function localDayKey(d: Date): string {
  // yyyy-mm-dd in local time. Using local (not UTC) because a user
  // who runs the daily cap out at 11pm shouldn't be locked out at
  // 1am the next day just because UTC crossed midnight first.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readBurstLimit(): number {
  const raw =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CHAT_BURST_LIMIT) || '';
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BURST_LIMIT;
}

function readDailyDefaultLimit(): number {
  const raw =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CHAT_DAILY_LIMIT) || '';
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

async function loadState(): Promise<ChatUsageState> {
  const raw = await storage.getChatUsage();
  if (!raw || typeof raw !== 'object') return emptyState();
  const s = raw as Partial<ChatUsageState>;
  if (s.version !== USAGE_VERSION) return emptyState();
  if (typeof s.dayKey !== 'string' || typeof s.dayCount !== 'number') return emptyState();
  if (!Array.isArray(s.burst)) return emptyState();
  return {
    dayKey: s.dayKey,
    dayCount: s.dayCount,
    dailyCap: typeof s.dailyCap === 'number' ? s.dailyCap : null,
    burst: s.burst.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)),
    version: USAGE_VERSION,
  };
}

async function saveState(s: ChatUsageState): Promise<void> {
  await storage.setChatUsage(s);
}

function trimBurst(burst: number[], now: number): number[] {
  const cutoff = now - BURST_WINDOW_MS;
  return burst.filter((t) => t > cutoff);
}

function nextBurstResetMs(burst: number[], now: number): number {
  if (burst.length === 0) return 0;
  const oldest = burst[0];
  return Math.max(0, oldest + BURST_WINDOW_MS - now);
}

function nextDailyResetMs(now: Date): number {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return Math.max(0, tomorrow.getTime() - now.getTime());
}

export interface ChatUsageSnapshot {
  dayCount: number;
  dailyCap: number;
  burstCount: number;
  burstCap: number;
  /** ms until the next burst slot frees (0 = no active burst). */
  burstResetMs: number;
  /** ms until local midnight (always > 0 unless exactly midnight). */
  dailyResetMs: number;
}

/**
 * Read the current usage state without mutating it. Used by the
 * settings screen (when one ships) to show "you've used 47 of 200
 * today" — and by tests.
 */
export async function getChatUsageSnapshot(now: Date = new Date()): Promise<ChatUsageSnapshot> {
  const s = await loadState();
  const today = localDayKey(now);
  const dayCount = s.dayKey === today ? s.dayCount : 0;
  const trimmed = trimBurst(s.burst, now.getTime());
  const dailyCap = s.dailyCap ?? readDailyDefaultLimit();
  return {
    dayCount,
    dailyCap,
    burstCount: trimmed.length,
    burstCap: readBurstLimit(),
    burstResetMs: nextBurstResetMs(trimmed, now.getTime()),
    dailyResetMs: nextDailyResetMs(now),
  };
}

/**
 * Persist a user-chosen daily cap. Pass null to revert to the
 * default. Caps are clamped to [1, 1000] — anything outside that
 * range is treated as a config bug and ignored.
 */
export async function setDailyLimit(value: number | null): Promise<void> {
  const s = await loadState();
  if (value === null) {
    s.dailyCap = null;
  } else if (Number.isFinite(value) && value >= 1 && value <= 1000) {
    s.dailyCap = Math.floor(value);
  }
  await saveState(s);
}

/**
 * Reserve a slot for the next call. Throws ChatUsageLimitError if
 * either limit is exhausted. On success, the slot is recorded so
 * the next call sees it.
 *
 * The CALLER is expected to call recordSuccess() after the network
 * round-trip completes successfully, and to NOT call
 * recordSuccess() on a network/timeout failure (the cost was
 * already incurred but we don't want to double-charge for retries).
 *
 * Actually, in the current design we record the slot on RESERVE
 * (not on success) — that way a stuck UI can't queue up a hundred
 * reserves without paying for them, and the burst cap matches the
 * "user pressed send N times" semantic, not the "backend received N
 * requests" semantic. The trade-off: a network failure still counts
 * against the limit. That's a deliberate cost-control choice, not a
 * bug.
 */
export async function reserveSlot(now: Date = new Date()): Promise<void> {
  const s = await loadState();
  const nowMs = now.getTime();
  const today = localDayKey(now);

  // Day rollover
  if (s.dayKey !== today) {
    s.dayKey = today;
    s.dayCount = 0;
  }
  // Trim burst
  s.burst = trimBurst(s.burst, nowMs);

  const dailyCap = s.dailyCap ?? readDailyDefaultLimit();
  const burstCap = readBurstLimit();

  if (s.dayCount >= dailyCap) {
    throw new ChatUsageLimitError(`Daily chat limit reached (${dailyCap})`, {
      limit: 'daily',
      used: s.dayCount,
      cap: dailyCap,
      resetMs: nextDailyResetMs(now),
    });
  }
  if (s.burst.length >= burstCap) {
    throw new ChatUsageLimitError(`Chat rate limit reached (${burstCap}/min)`, {
      limit: 'burst',
      used: s.burst.length,
      cap: burstCap,
      resetMs: nextBurstResetMs(s.burst, nowMs),
    });
  }

  s.dayCount += 1;
  s.burst.push(nowMs);
  await saveState(s);
}

/**
 * Test-only: clear all usage state. Used by the offline eval set
 * and by the "reset" affordance (when it ships). Not exported
 * through the UI surface.
 */
export async function resetUsage(): Promise<void> {
  await saveState(emptyState());
}
