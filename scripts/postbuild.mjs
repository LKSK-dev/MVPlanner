// T0.2 — finalize the single-file build:
//  1. rename dist/index.html -> dist/MVPlanner.html
//  2. assert the output is truly a single file (no leftover .js/.css assets)
//  3. run the size-budget gate
import { readdirSync, renameSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

// CSP assertion (T8.12; spec plan/08 §8.3): the strict Content-Security-Policy
// <meta> from index.html must survive into the inlined artifact. The single-file
// model relies on script-src 'unsafe-inline'; assert the meta + key directives
// are present so a build/tooling change can never silently drop the policy.
const html = readFileSync(OUT, 'utf8');
const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
if (!cspMatch) {
  console.error(`postbuild — CSP <meta> missing from ${OUT}; refusing to ship without a policy`);
  process.exit(1);
}
const csp = cspMatch[1];
const requiredDirectives = [
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  'worker-src blob:',
  'connect-src',
  'script-src',
];
const missing = requiredDirectives.filter((d) => !csp.includes(d));
if (missing.length > 0) {
  console.error(`postbuild — CSP <meta> is missing required directive(s): ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`postbuild — wrote ${OUT} (single-file OK; CSP <meta> present)`);
execFileSync('node', ['scripts/check-size.mjs'], { stdio: 'inherit' });
