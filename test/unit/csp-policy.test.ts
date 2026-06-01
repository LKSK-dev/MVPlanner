/**
 * Content-Security-Policy posture (task T8.12; spec plan/08 §8.3).
 *
 * Asserts the strict CSP `<meta>` lives in `index.html` with the directives the
 * single-file inline model needs. The complementary build-time guarantee — that
 * the meta survives into `dist/MVPlanner.html` — is enforced by the postbuild
 * assertion in `scripts/postbuild.mjs` (and verified by the build gate).
 */
import { describe, expect, it } from 'vitest';
// Vite `?raw` inlines the source HTML as a string (typed via vite/client).
import indexHtml from '../../index.html?raw';

function cspContent(html: string): string {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  expect(m, 'CSP <meta> present in index.html').toBeTruthy();
  return m?.[1] ?? '';
}

describe('strict CSP <meta> (T8.12)', () => {
  const csp = cspContent(indexHtml);

  it('locks down object/base/frame embedding', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('allows the inlined single-file bundle + scripting-console eval', () => {
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it('permits inlined + sandboxed workers and map-tile imagery', () => {
    expect(csp).toMatch(/worker-src[^;]*blob:/);
    expect(csp).toMatch(/img-src[^;]*https:/);
  });

  it('permits user-configured network endpoints (egress is surfaced, not blocked)', () => {
    expect(csp).toMatch(/connect-src[^;]*https:/);
    expect(csp).toMatch(/connect-src[^;]*wss:/);
  });
});
