// T0.2 — finalize the single-file build:
//  1. rename dist/index.html -> dist/MVPlanner.html
//  2. assert the output is truly a single file (no leftover .js/.css assets)
//  3. run the size-budget gate
import { readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIST = 'dist';
const SRC = `${DIST}/index.html`;
const OUT = `${DIST}/MVPlanner.html`;

if (!existsSync(SRC)) {
  console.error(`postbuild — expected ${SRC} from vite build; not found`);
  process.exit(1);
}
renameSync(SRC, OUT);

// Single-file assertion: nothing but the one HTML file (+ vite .vite cache dir) may remain.
const stray = readdirSync(DIST).filter(
  (f) => f !== 'MVPlanner.html' && /\.(js|mjs|css|map)$/.test(f),
);
if (stray.length > 0) {
  console.error(`postbuild — NOT a single file; stray assets in dist/: ${stray.join(', ')}`);
  process.exit(1);
}
const viteCache = `${DIST}/.vite`;
if (existsSync(viteCache)) rmSync(viteCache, { recursive: true, force: true });

console.log(`postbuild — wrote ${OUT} (single-file OK)`);
execFileSync('node', ['scripts/check-size.mjs'], { stdio: 'inherit' });
