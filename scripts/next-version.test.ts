// v0.10 (issue #53): tests for the version-bump math used
// by the release workflow. The actual `next-version.sh` is
// a bash script (executed by GitHub Actions) — these tests
// pin the math in TypeScript so a future bump rule change
// can't silently break the version sequence.

import { describe, expect, it } from 'vitest';

// Mirror the bash logic from .github/workflows/release.yml
// `bump-version-pr.jobs.steps.next.run`. Keep in sync.
function nextVersion(current: string): string {
  // Bump patch: 0.9.0 -> 0.9.1. v1+ follows semver minor
  // (the v0.x series bumps the minor instead).
  const stripped = current.startsWith('v') ? current.slice(1) : current;
  const parts = stripped.split('.');
  const major = parseInt(parts[0] ?? '0', 10);
  const minor = parseInt(parts[1] ?? '0', 10);
  const patch = parseInt(parts[2] ?? '0', 10);
  if (major === 0) {
    return `0.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

describe('release version-bump math (issue #53)', () => {
  it('v0.x bumps the minor (0.9.0 -> 0.10.0)', () => {
    expect(nextVersion('0.9.0')).toBe('0.10.0');
    expect(nextVersion('0.9.1')).toBe('0.10.0');
    expect(nextVersion('0.10.5')).toBe('0.11.0');
    expect(nextVersion('0.0.0')).toBe('0.1.0');
  });

  it('v1+ bumps the patch (1.0.0 -> 1.0.1)', () => {
    expect(nextVersion('1.0.0')).toBe('1.0.1');
    expect(nextVersion('1.4.2')).toBe('1.4.3');
  });

  it('accepts the leading v in the input', () => {
    expect(nextVersion('v0.9.0')).toBe('0.10.0');
    expect(nextVersion('v1.4.2')).toBe('1.4.3');
  });
});
