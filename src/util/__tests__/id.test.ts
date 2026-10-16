import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../id';

describe('newId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('uses crypto.randomUUID when available', () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('still returns unique ids when crypto is missing', () => {
    vi.stubGlobal('crypto', undefined);
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
