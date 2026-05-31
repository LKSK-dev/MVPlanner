import { defineConfig } from 'vitest/config';

// Unit tests run as pure logic by default (no Solid JSX transform needed here);
// component/DOM tests are added with their owning UI tasks (T0.7/T0.8).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.npm-cache'],
  },
});
