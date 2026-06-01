/**
 * RTL / logical-CSS audit (T8.11; spec plan/05 §5.8/§5.9 "RTL layout support
 * (logical CSS properties)", plan/10 §10.5).
 *
 * Asserts that the high-traffic shell + Plan data-table stylesheets use LOGICAL
 * box properties (`margin-inline-*`, `inset-inline-*`, `border-inline-*`,
 * `text-align: start|end`) rather than physical ones (`margin-left`, `right`,
 * `border-left`, `text-align: left|right`) so they mirror correctly under
 * `dir="rtl"`. Scope is the surfaces this pass converted; map/HUD canvas-overlay
 * corner positioning is documented as deferred in docs/a11y-checklist.md.
 *
 * Browser-rendered RTL visual diffing remains a Playwright concern; this is the
 * static, sandbox-runnable guard against regressions in the converted files.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Resolve a repo-root-relative path (vitest runs with cwd = repo root). */
const repoPath = (rel: string): string => resolve(process.cwd(), rel);

/** Stylesheets converted to logical properties by the T8.11 RTL pass. */
const CONVERTED_CSS: readonly string[] = [
  'src/ui/shell/shell.css',
  'src/ui/shell/connection/connection.css',
  'src/ui/screens/plan/table/wp-table.css',
  'src/ui/screens/plan/fence/fence.css',
  'src/ui/screens/plan/rally/rally.css',
  'src/ui/screens/plan/survey/survey.css',
];

/** Physical declarations that should no longer appear in the converted files. */
const FORBIDDEN: readonly { label: string; re: RegExp }[] = [
  { label: 'margin-left', re: /\bmargin-left\s*:/ },
  { label: 'margin-right', re: /\bmargin-right\s*:/ },
  { label: 'padding-left', re: /\bpadding-left\s*:/ },
  { label: 'padding-right', re: /\bpadding-right\s*:/ },
  { label: 'border-left', re: /\bborder-left\s*:/ },
  { label: 'border-right', re: /\bborder-right\s*:/ },
  { label: 'physical left:', re: /(^|[;{]\s*)left\s*:/m },
  { label: 'physical right:', re: /(^|[;{]\s*)right\s*:/m },
  { label: 'text-align: left', re: /text-align\s*:\s*left/ },
  { label: 'text-align: right', re: /text-align\s*:\s*right/ },
];

describe('RTL: converted stylesheets use logical box properties', () => {
  for (const rel of CONVERTED_CSS) {
    it(`${rel} has no physical-direction declarations`, () => {
      const css = readFileSync(repoPath(rel), 'utf8');
      const found = FORBIDDEN.filter(({ re }) => re.test(css)).map(({ label }) => label);
      expect(found, `${rel} still uses: ${found.join(', ')}`).toEqual([]);
    });
  }

  it('shell.css uses inline-logical equivalents', () => {
    const css = readFileSync(repoPath('src/ui/shell/shell.css'), 'utf8');
    expect(css).toContain('margin-inline-start: auto');
    expect(css).toContain('inset-inline-end: var(--mvp-gap)');
    expect(css).toContain('border-inline-start: 3px solid var(--mvp-accent)');
  });

  it('Plan data tables align with start/end (mirror under RTL)', () => {
    const css = readFileSync(repoPath('src/ui/screens/plan/table/wp-table.css'), 'utf8');
    expect(css).toContain('text-align: start');
    expect(css).toContain('text-align: end');
  });
});
