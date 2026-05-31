/**
 * Tiny dependency-free fuzzy matcher for the command palette (T0.7; spec
 * plan/05 §5.7). Pure and unit-testable in isolation from the DOM.
 *
 * Scoring favours contiguous and word-boundary matches so that typing an
 * acronym ("gtf" → "Go to Flight") or a prefix ranks the obvious result first.
 */

/** Result of scoring a candidate against a query. */
export interface FuzzyMatch {
  /** Higher is better; `undefined` when the query is not a subsequence. */
  readonly score: number;
}

/**
 * Score `text` against `query` as a case-insensitive subsequence match.
 * Returns `undefined` when `query` is not a subsequence of `text`. An empty
 * query matches everything with a neutral score so the palette lists all
 * commands initially.
 */
export function fuzzyScore(text: string, query: string): number | undefined {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const t = text.toLowerCase();

  let score = 0;
  let ti = 0;
  let prevMatchIdx = -2;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi]!;
    const found = t.indexOf(ch, ti);
    if (found === -1) return undefined;
    // Contiguous match bonus.
    if (found === prevMatchIdx + 1) score += 8;
    // Word-boundary / start bonus.
    if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '.') score += 6;
    // Closeness bonus (prefer earlier matches).
    score += Math.max(0, 4 - (found - ti));
    prevMatchIdx = found;
    ti = found + 1;
  }
  return score;
}

/**
 * Filter + rank `items` by `query` using {@link fuzzyScore}. Stable for equal
 * scores (preserves input order). An empty/whitespace query returns the input
 * order unchanged.
 */
export function fuzzyFilter<T>(items: readonly T[], query: string, key: (item: T) => string): T[] {
  const q = query.trim();
  if (q.length === 0) return [...items];
  const scored: Array<{ item: T; score: number; idx: number }> = [];
  items.forEach((item, idx) => {
    const score = fuzzyScore(key(item), q);
    if (score !== undefined) scored.push({ item, score, idx });
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((s) => s.item);
}
