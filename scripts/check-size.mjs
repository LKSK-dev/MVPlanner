// V4 — single-file size-budget gate (spec plan/08 §8.1, impl 05).
// Target ≤ 5 MB, hard limit ≤ 8 MB for the inlined release artifact.
import { statSync } from 'node:fs';

const FILE = 'dist/MVPlanner.html';
const TARGET_MB = 5;
const LIMIT_MB = 8;

let size;
try {
  size = statSync(FILE).size;
} catch {
  console.error(`check:size — build artifact not found: ${FILE} (run \`npm run build\` first)`);
  process.exit(1);
}

const mb = size / (1024 * 1024);
const fmt = mb.toFixed(2);
console.log(`Single-file size: ${fmt} MB  (target ≤ ${TARGET_MB} MB, hard limit ≤ ${LIMIT_MB} MB)`);

if (mb > LIMIT_MB) {
  console.error(`SIZE BUDGET EXCEEDED: ${fmt} MB > ${LIMIT_MB} MB hard limit`);
  process.exit(1);
}
if (mb > TARGET_MB) {
  console.warn(`note: over the ${TARGET_MB} MB target (within hard limit) — watch payload growth`);
}
