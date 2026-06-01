// T8.10 size report: single-file artifact plus bundled-dialect redundancy note.
// This complements scripts/check-size.mjs; it reports the known optimization
// without performing the dialect refactor.
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ARTIFACT = 'dist/MVPlanner.html';
const COMMON = 'src/mavlink/dialects/generated/common.json';
const ARDUPILOTMEGA = 'src/mavlink/dialects/generated/ardupilotmega.json';
const TARGET_BYTES = 5 * 1024 * 1024;
const HARD_LIMIT_BYTES = 8 * 1024 * 1024;

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let artifactBytes;
let artifactGzipBytes;
try {
  const artifact = readFileSync(ARTIFACT);
  artifactBytes = statSync(ARTIFACT).size;
  artifactGzipBytes = gzipSync(artifact).byteLength;
} catch {
  console.error(
    `size-report — build artifact not found: ${ARTIFACT} (run \`npm run build\` first)`,
  );
  process.exit(1);
}

const commonBytes = statSync(COMMON).size;
const ardupilotmegaBytes = statSync(ARDUPILOTMEGA).size;
const common = readJson(COMMON);
const ardupilotmega = readJson(ARDUPILOTMEGA);
const commonEntries = Object.entries(common.messages ?? {});
const commonIsMessageSubset = commonEntries.every(([id, message]) => {
  const candidate = ardupilotmega.messages?.[id];
  return candidate?.name === message?.name;
});

console.log('T8.10 size report');
console.log(
  `Single-file size: ${formatMiB(artifactBytes)} raw / ${formatMiB(artifactGzipBytes)} gzip ` +
    `(target ≤ ${formatMiB(TARGET_BYTES)}, hard ≤ ${formatMiB(HARD_LIMIT_BYTES)})`,
);
console.log(
  `Bundled MAVLink dialect JSON: common=${formatMiB(commonBytes)}, ` +
    `ardupilotmega=${formatMiB(ardupilotmegaBytes)}, common message subset=${String(commonIsMessageSubset)}`,
);
console.log(
  `Tracked optimization: common.json is a subset of ardupilotmega.json and costs ~${formatMiB(commonBytes)} raw. ` +
    'The microservice constants path imports commonDialect; repointing those constants to ardupilotmega-only would save this redundancy. ' +
    'Not changed in T8.10 because the artifact is currently within the §8.1 size budget.',
);

if (artifactBytes > HARD_LIMIT_BYTES) {
  console.error(
    `SIZE BUDGET EXCEEDED: ${formatMiB(artifactBytes)} > ${formatMiB(HARD_LIMIT_BYTES)}`,
  );
  process.exit(1);
}
if (artifactBytes > TARGET_BYTES) {
  console.warn(
    `note: over target but within hard limit (${formatMiB(artifactBytes)} > ${formatMiB(TARGET_BYTES)})`,
  );
}
