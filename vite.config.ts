import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Dev: standard modular Vite app with HMR.
// Build: vite-plugin-singlefile inlines JS/CSS into one dist/index.html,
// which scripts/postbuild.mjs renames to dist/MVPlanner.html (spec plan/02 §2.2).
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
  },
});
