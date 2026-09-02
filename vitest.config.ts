import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    // v0.10 (issue #53): also pick up release-workflow tests
    // under scripts/. The release version-bump math is
    // duplicated in scripts + TypeScript so the workflow
    // doesn't drift; the TS version is the source of truth
    // and gets unit tests.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
