// Message/audit IDs. Prefer crypto.randomUUID, but don't depend on it: if the
// JS runtime lacks it, every chat send — including a crisis message — would
// throw before the crisis modal could open.
export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
