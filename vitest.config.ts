import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

// The unit-test harness uses vite-plugin-solid + the 'browser'/'development'
// resolve conditions so solid-js resolves its REACTIVE build (not the SSR
// no-op build). This lets reactive store/UI tests actually exercise
// createMemo/createEffect. happy-dom provides the DOM/MessageChannel APIs.
export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ['development', 'browser'],
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.npm-cache'],
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
});
