/**
 * Parity guard for the hand-maintained example-extension typings (audit §6.2):
 * every runtime export in `extensions/index.js` must have a matching declaration
 * in `extensions/index.d.ts`, and the `examples` array must list them all. This
 * fails fast if a new example is added to the .js but not the .d.ts (or vice
 * versa), keeping the hand-written declarations from drifting.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { examples } from '../../extensions/index.js';

const root = process.cwd();
const js = readFileSync(resolve(root, 'extensions/index.js'), 'utf8');
const dts = readFileSync(resolve(root, 'extensions/index.d.ts'), 'utf8');

/** Names inside the `export { ... }` block of index.js. */
function jsNamedExports(): string[] {
  const block = js.match(/export\s*\{([^}]*)\}/u)?.[1] ?? '';
  return block
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** `export const X:` declarations in index.d.ts (excluding `examples`). */
function dtsConstExports(): string[] {
  const out: string[] = [];
  for (const m of dts.matchAll(/export const (\w+)\s*:/gu)) {
    const name = m[1];
    if (name !== undefined && name !== 'examples') out.push(name);
  }
  return out;
}

describe('extensions/index.d.ts parity', () => {
  it('declares exactly the runtime named module exports', () => {
    expect([...dtsConstExports()].sort()).toEqual([...jsNamedExports()].sort());
  });

  it('lists every named module in the examples array', () => {
    expect(examples).toHaveLength(jsNamedExports().length);
  });
});
