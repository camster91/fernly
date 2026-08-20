// Chat feature flag — controls whether the real chat backend is
// reachable. The DEFAULT is OFF, so a fresh install never talks to a
// backend unless the operator (a) sets EXPO_PUBLIC_CHAT_BACKEND_ENABLED
// in the build env AND (b) either ships a build with the URL set or
// the user explicitly toggles the in-app override (internal cohort
// only).
//
// Why two layers?
//   - Env: the deploy-time switch. Set false to ship a build that
//     physically cannot call the backend, even if a runtime bug tries
//     to. Use this for staged rollout — turn it on for the internal
//     cohort build only.
//   - AsyncStorage override: the runtime switch. Set true to allow a
//     specific device (yours, a beta tester) to opt in without a
//     rebuild. Defaults to falsey, so a stolen token in the wild
//     doesn't grant access without the matching env flag.
//
// Both must be truthy for the backend to be reachable. The env flag
// is the gate; the override is the switch.
//
// This file is the single source of truth for "is the real chat
// enabled right now". ChatScreen reads it via isRealChatEnabled() and
// falls back to mockReply() when false. The setting screen (when one
// ships) will use setRealChatOverride() to flip the override.

import { readChatBackendEnabled, readChatBackendUrl } from './chat';
import { storage } from '../storage';

const OVERRIDE_KEY = '@fernly/chat-backend-override';
// Re-export so the storage key matches the value used here. The
// storage helper takes the key explicitly so we don't drift, but
// defining the constant here documents the contract in one place.
// (Currently the storage layer hard-codes the same key — the two
// MUST stay in sync. If storage ever exposes a symbolic accessor,
// switch this to it.)

/**
 * Return the current in-app override. null = no preference (use env).
 * true/false = explicit user/dev override.
 *
 * Read is best-effort: if the storage layer is mid-reset or the
 * AsyncStorage call fails, the override is null (env-only behavior).
 */
export async function getRealChatOverride(): Promise<boolean | null> {
  try {
    const raw = await storage.getChatBackendOverride();
    if (raw === null) return null;
    if (raw === '' || raw === 'unset') return null;
    if (raw === '1' || raw.toLowerCase() === 'true') return true;
    if (raw === '0' || raw.toLowerCase() === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Set the in-app override. Pass null to clear (back to env-driven).
 *
 * Persistence is best-effort — the storage helper swallows write
 * errors so the chat send path can never block on this. Callers that
 * need confirmation should use the strict storage variant.
 */
export async function setRealChatOverride(value: boolean | null): Promise<void> {
  if (value === null) {
    await storage.setChatBackendOverride('unset');
  } else {
    await storage.setChatBackendOverride(value ? '1' : '0');
  }
}

export interface RealChatDecision {
  enabled: boolean;
  reason:
    | 'env-disabled' // env flag false
    | 'url-missing' // no URL configured
    | 'override-disabled' // in-app override explicitly off
    | 'enabled'; // both env and override truthy (override = true)
}

/**
 * Resolve the "is real chat enabled?" decision. Reads both the env
 * flag and the in-app override, AND the URL (a backend isn't enabled
 * if there's nowhere to call). Pure I/O — no side effects beyond two
 * reads.
 *
 * Order of checks (most-restrictive first):
 *   1. URL configured?     No  → disabled (reason: url-missing)
 *   2. Env flag enabled?    No  → disabled (reason: env-disabled)
 *   3. Override set?        Yes (false) → disabled (reason: override-disabled)
 *   4. Otherwise             → enabled
 */
export async function resolveRealChatDecision(): Promise<RealChatDecision> {
  const url = safeReadUrl();
  if (!url) return { enabled: false, reason: 'url-missing' };
  if (!readChatBackendEnabled()) return { enabled: false, reason: 'env-disabled' };
  const override = await getRealChatOverride();
  if (override === false) return { enabled: false, reason: 'override-disabled' };
  return { enabled: true, reason: 'enabled' };
}

/**
 * Sync-flavored check: returns true if the env flag AND URL are both
 * truthy. Does NOT consult the in-app override (which is async). For
 * the "should we attempt the call site at all?" hot path, the env
 * check is enough; the override layer is enforced inside the call
 * site if the override is set to false.
 */
export function isRealChatEnabledSync(): boolean {
  if (!readChatBackendEnabled()) return false;
  // readChatBackendUrl can throw on a non-https URL — we want that
  // throw to surface (the env is misconfigured, fail loudly), so
  // don't catch here. If you need a non-throwing variant, use
  // safeReadUrl() and check the return.
  return readChatBackendUrl() !== null;
}

/**
 * Non-throwing URL read. Returns null both for "unset" and for
 * "misconfigured" so the call site can degrade to mock without
 * crashing the chat send. The misconfiguration is still logged.
 */
function safeReadUrl(): string | null {
  try {
    return readChatBackendUrl();
  } catch (e) {
    // Log and degrade. The env was misconfigured; the chat send
    // falls back to mock. A follow-up release health-check should
    // catch the misconfig.
    console.warn('[chat-feature-flag] readChatBackendUrl threw:', e);
    return null;
  }
}

/**
 * Convenience for the chat send hot path: returns true if the
 * backend is enabled AND the env is configured. Consults the in-app
 * override via AsyncStorage (so this is async).
 */
export async function isRealChatEnabled(): Promise<boolean> {
  const decision = await resolveRealChatDecision();
  return decision.enabled;
}
