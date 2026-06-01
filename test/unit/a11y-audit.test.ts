/**
 * "No hard-coded UI strings" + a11y attribute audit (T8.11; spec plan/05 §5.8
 * a11y, §5.9 i18n, conventions plan/implementation/00 §0.3, plan/10 §10.5).
 *
 * Statically scans every `src/ui/**` `.tsx` source for user-facing strings that
 * bypass `t()`:
 *
 * - **a11y/text attributes** (`aria-label`, `aria-description`, `title`, `alt`,
 *   `placeholder`) assigned a STRING LITERAL rather than a `{expression}` — a
 *   literal there is copy that never routed through the catalog.
 * - **multi-word JSX text nodes** (`>Some Words<`) — visible copy hard-coded in
 *   markup. (TypeScript generics like `Promise<…>` have no spaces and are
 *   filtered out; expression children `{…}` are excluded.)
 *
 * The codebase has held this discipline since M0; this test pins it so a
 * regression fails in the sandbox unit suite (the full rendered-DOM scan is the
 * Playwright/axe CI gate, browser-deferred).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs with cwd = repo root.
const uiRoot = resolve(process.cwd(), 'src/ui');

/** Recursively collect every `.tsx` file under `dir`. */
function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collectTsx(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const tsxFiles = collectTsx(uiRoot);

/** Attributes whose value must be a `{t(...)}` expression, never a literal. */
const TEXT_ATTRS = ['aria-label', 'aria-description', 'title', 'alt', 'placeholder'];
const LITERAL_ATTR_RE = new RegExp(
  `\\b(${TEXT_ATTRS.join('|')})\\s*=\\s*"([^"]*[A-Za-z]{2}[^"]*)"`,
  'g',
);

/** Candidate JSX text node: `>text<` with letters. Filtered below. */
const JSX_TEXT_RE = />\s*([A-Za-z][A-Za-z ,.'’!?:;/&%-]{2,})\s*</g;

/**
 * TypeScript tokens that appear between `>`/`<` in `.tsx` TYPE/EXPRESSION code
 * (generics, `new T<…>`) rather than JSX text. A candidate containing any of
 * these is code, not user-facing copy.
 */
const CODE_TOKEN_RE =
  /\b(new|typeof|keyof|extends|infer|as|Promise|Map|Set|WeakMap|Array|Readonly|ReadonlyMap|ReadonlyArray|Record|Partial|Required|Pick|Omit|Exclude|Extract|Awaited|ReturnType|Parameters|Component|Accessor|Signal)\b/;

describe('a11y/i18n audit: no hard-coded UI strings', () => {
  it('discovers UI source files to scan', () => {
    expect(tsxFiles.length).toBeGreaterThan(20);
  });

  it('has no string-literal a11y/text attributes (all route through t())', () => {
    const violations: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(LITERAL_ATTR_RE)) {
        violations.push(`${file.replace(uiRoot, 'src/ui')}: ${m[1]}="${m[2]}"`);
      }
    }
    expect(violations, `literal attributes:\n${violations.join('\n')}`).toEqual([]);
  });

  it('has no multi-word hard-coded JSX text nodes', () => {
    const violations: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(JSX_TEXT_RE)) {
        const text = (m[1] ?? '').trim();
        // Multi-word visible copy only; single tokens are TS generics/identifiers.
        if (!text.includes(' ')) continue;
        // Exclude expression fragments captured across `{…()…}`.
        if (/[(){}]/.test(text)) continue;
        // Exclude TS generic/expression code (e.g. `new Promise<…>`).
        if (CODE_TOKEN_RE.test(text)) continue;
        violations.push(`${file.replace(uiRoot, 'src/ui')}: >${text}<`);
      }
    }
    expect(violations, `hard-coded JSX text:\n${violations.join('\n')}`).toEqual([]);
  });
});
