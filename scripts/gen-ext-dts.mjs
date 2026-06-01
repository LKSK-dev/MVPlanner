// Generate the bundled extension-API `.d.ts` surfaced to the scripting console
// (T7.4) / API reference (T7.5) for editor autocomplete (task T7.3; spec
// plan/06 §6.4/§6.10).
//
// The `mvp`/`ctx` type closure is exactly these frozen contract files (every
// `import` between them stays inside the set), so concatenating them — minus the
// intra-bundle `import type` lines — yields a self-contained declaration. The
// app version is injected at use via the `__EXT_API_VERSION__` placeholder
// (see `src/ext/api/dts.ts`). The result is written as a checked-in TS module
// (`src/ext/api/generated-dts.ts`) so it ships in the single-file bundle.
//
// Regenerate after any `src/contracts` change in the closure:
//   node scripts/gen-ext-dts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order (referenced types precede their users); this is the closure
// of `ext-api.ts` — verified by the sync test in `test/unit/ext-api.test.ts`.
const CONTRACT_FILES = [
  'transport.ts',
  'vehicle.ts',
  'mavlink.ts',
  'microservices.ts',
  'map.ts',
  'store.ts',
  'ui.ts',
  'ext-api.ts',
];

/** Strip the intra-bundle `import type { ... } from './x';` lines (single/multi-line). */
function stripIntraBundleImports(src) {
  return src.replace(/^import type \{[\s\S]*?\} from '\.\/[^']+';\n/gm, '');
}

/** Build the self-contained `.d.ts` bundle string (pure; used by the sync test). */
export function generateExtApiDtsBundle() {
  const banner = [
    '/**',
    ' * MVPlanner extension API — v__EXT_API_VERSION__ (semver-locked at M7).',
    ' *',
    ' * AUTO-GENERATED from src/contracts by scripts/gen-ext-dts.mjs — do not edit.',
    ' * Surfaced to the scripting console / API reference for editor autocomplete.',
    ' */',
    '',
  ].join('\n');

  const sections = CONTRACT_FILES.map((file) => {
    const src = readFileSync(join(ROOT, 'src/contracts', file), 'utf8');
    return `// ── contracts/${file} ${'─'.repeat(Math.max(0, 60 - file.length))}\n${stripIntraBundleImports(src).trim()}\n`;
  });

  const footer = [
    '',
    '/** The capability-scoped context passed to `activate(ctx)`. */',
    'declare const ctx: ExtContext;',
    '/** The scripting-console global (same surface, scripting permission profile). */',
    'declare const mvp: ExtContext;',
    '',
  ].join('\n');

  return `${banner}\n${sections.join('\n')}\n${footer}`;
}

/** Render the checked-in TS module wrapping the bundle as a string constant. */
export function generateExtApiDtsModule() {
  const bundle = generateExtApiDtsBundle();
  return [
    '/**',
    ' * AUTO-GENERATED bundled extension-API declaration (task T7.3).',
    ' *',
    ' * Do not edit by hand — regenerate with `node scripts/gen-ext-dts.mjs`.',
    ' * See `./dts.ts` for the version-injecting accessor and `./README.md`.',
    ' */',
    '',
    `export const EXT_API_DTS = ${JSON.stringify(bundle)};`,
    '',
  ].join('\n');
}

// Write the module when run directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(ROOT, 'src/ext/api/generated-dts.ts');
  writeFileSync(out, generateExtApiDtsModule(), 'utf8');
  console.log(`wrote ${out}`);
}
