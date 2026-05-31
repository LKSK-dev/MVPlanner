import { defineConfig } from 'vitest/config';

/**
 * M1-gate LIVE integration smoke (spec plan/05 §5.3; WBS M1 gate / T1.9 / T1.13).
 *
 * Unlike the root unit harness (happy-dom, `test/unit/**`), this suite spawns
 * real OS processes — a pymavlink "fake vehicle" (TCP) and the committed
 * companion bridge (ws) — and drives a REAL {@link MavlinkSession} from the
 * resulting live byte stream. It therefore needs:
 *   - the 'node' environment, so the global `WebSocket` client + `node:net` /
 *     `node:child_process` are the real Node implementations (not happy-dom);
 *   - generous timeouts to absorb process startup + the TCP/ws handshake race.
 *
 * It is intentionally NOT in the root vitest `include`, so `npm test` never runs
 * it (it requires python + spawnable processes). Run it explicitly with:
 *   npx vitest run --config test/integration-sitl/vitest.config.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/integration-sitl/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.npm-cache'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
