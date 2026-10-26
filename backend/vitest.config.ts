import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/tests/globalSetup.ts'],
    setupFiles: ['src/tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // One in-memory MongoDB per run; keep files sequential for stability.
    fileParallelism: false,
    pool: 'forks',
  },
});
