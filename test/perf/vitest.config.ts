import { defineConfig } from 'vitest/config';

/**
 * V3 perf harness (spec plan/05 §5.1, expanded by T8.10).
 *
 * This suite is intentionally separate from the root unit harness: it runs in
 * Node, performs measurement-oriented checks with generous CI thresholds, and
 * prints telemetry/log/size numbers for budget review.
 *
 * Run explicitly with:
 *   npx vitest run --config test/perf/vitest.config.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/perf/**/*.perf.test.ts'],
    exclude: ['node_modules', 'dist', '.npm-cache'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
