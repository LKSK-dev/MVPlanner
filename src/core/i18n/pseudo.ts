/**
 * Pseudo-localization utility (T8.11; spec plan/05 §5.8/§5.9, plan/10 §10.5).
 *
 * Pseudo-localization is a dev/test locale that mechanically transforms the
 * English source strings to surface i18n defects WITHOUT a human translator:
 *
 * - **Accented glyphs** — every ASCII letter is replaced with a look-alike
 *   accented glyph (`Hello` → `Ħéļļö`). Any string that renders as plain ASCII
 *   at runtime is therefore a **hard-coded (non-`t()`) string** — it never went
 *   through the catalog. This is the automated "no hard-coded UI strings" net.
 * - **Length expansion** — the text is padded by ~40% (German/Finnish grow vs.
 *   English) so **truncation/clipping/overflow** defects show up at design time.
 * - **Boundary markers** — each translated unit is wrapped in `⟦…⟧` so
 *   **string concatenation** (building a sentence from fragments instead of one
 *   parameterised key) is visible as multiple bracket pairs in one phrase.
 *
 * `{var}` interpolation placeholders are preserved verbatim (NOT pseudo-ized),
 * so `t('x', { n })` still substitutes correctly under the pseudo locale.
 *
 * This is a runtime-registerable locale (no new deps). Full visual axe scans
 * remain the Playwright/axe CI gate (browser-deferred); this layer is the
 * sandbox-runnable, unit-testable slice.
 */
import type { MessageCatalog } from './catalog';
import { getMessages, registerLocale, setLocale, type LocaleCode } from './locale';

/**
 * The pseudo-locale code. `en-XA` follows the de-facto convention (Chrome,
 * Android, FBT) for an English-derived accented pseudo-locale.
 */
export const PSEUDO_LOCALE: LocaleCode = 'en-XA';

/** Per-letter accented look-alike map (ASCII a–z / A–Z → Latin-1/Extended). */
const ACCENT_MAP: Readonly<Record<string, string>> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ɋ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ҳ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ħ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ɋ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ҳ',
  Y: 'Ý',
  Z: 'Ž',
};

/** Splits a template into literal runs and `{var}` placeholder runs. */
const PLACEHOLDER_RE = /(\{[^}]+\})/g;

/** Fraction by which to pad a literal run to simulate translation growth. */
const EXPANSION_RATIO = 0.4;

/** Padding glyphs cycled through when expanding a run (visually inert). */
const PAD_GLYPHS = '\u2024\u2024\u2024'; // one-dot leaders

/** Accent a single literal run (leaving non-letters, incl. spaces, intact). */
function accentRun(run: string): string {
  let out = '';
  for (const ch of run) {
    out += ACCENT_MAP[ch] ?? ch;
  }
  return out;
}

/** Build a padding suffix that grows a literal run by ~{@link EXPANSION_RATIO}. */
function expansionFor(run: string): string {
  const letters = run.replace(/[^A-Za-z]/g, '').length;
  const extra = Math.ceil(letters * EXPANSION_RATIO);
  if (extra <= 0) return '';
  let pad = '';
  for (let i = 0; i < extra; i += 1) {
    pad += PAD_GLYPHS[i % PAD_GLYPHS.length];
  }
  return pad;
}

/**
 * Pseudo-localize a single template string: accent its letters, expand its
 * length by ~40%, and wrap the whole unit in `⟦…⟧` boundary markers. `{var}`
 * placeholders pass through untouched so interpolation still works.
 *
 * @param template - The English source template (may contain `{var}` slots).
 * @returns The pseudo-localized template.
 */
export function pseudoLocalize(template: string): string {
  if (template === '') return '\u27e6\u27e7';
  // split() with a capturing group yields the `{var}` runs as standalone
  // entries; everything else is literal text to accent + expand.
  const parts = template.split(PLACEHOLDER_RE);
  let body = '';
  let pad = '';
  for (const part of parts) {
    if (part === '') continue;
    if (part.length >= 2 && part.startsWith('{') && part.endsWith('}')) {
      body += part;
    } else {
      body += accentRun(part);
      pad += expansionFor(part);
    }
  }
  return `\u27e6${body}${pad}\u27e7`;
}

/**
 * Derive a full pseudo-localized {@link MessageCatalog} from a source catalog
 * (defaults to the live English catalog, so it captures every key contributed
 * via `registerMessages` at import time).
 *
 * @param source - Catalog to transform; defaults to the registered `en` catalog.
 */
export function buildPseudoCatalog(source: MessageCatalog = getMessages()): MessageCatalog {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = pseudoLocalize(value);
  }
  return out;
}

/**
 * Register the pseudo-locale under {@link PSEUDO_LOCALE} from the CURRENT English
 * catalog. Call AFTER the UI modules have imported (so their `registerMessages`
 * keys are present). Idempotent-ish: re-registering re-snapshots English.
 *
 * @returns The registered pseudo-locale code, for convenience.
 */
export function registerPseudoLocale(): LocaleCode {
  registerLocale(PSEUDO_LOCALE, buildPseudoCatalog());
  return PSEUDO_LOCALE;
}

/**
 * Dev/test helper: register the pseudo-locale (from the live English catalog)
 * and switch the active locale to it. Equivalent to
 * `setLocale(registerPseudoLocale())`.
 *
 * @returns The active pseudo-locale code.
 */
export function enablePseudoLocale(): LocaleCode {
  const code = registerPseudoLocale();
  setLocale(code);
  return code;
}
