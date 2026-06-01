/**
 * API-surface extraction for autocomplete (task T7.4; spec plan/06 §6.7
 * "autocomplete from API types").
 *
 * PURE and CodeMirror-free: parses the top-level members of the `ExtContext`
 * interface out of the bundled `.d.ts` (from
 * {@link import('../api').buildExtApiDts}) so the console can offer best-effort
 * `mvp.` member completions. It relies only on the generator's stable 2-space
 * indentation (top-level members are indented exactly two spaces; nested members
 * are deeper), so a simple, dependency-free scan is sufficient. The CodeMirror
 * completion-source wrapper lives in the console widget (UI layer).
 */

/** One completable member of the `mvp` / `ctx` surface. */
export interface ApiMember {
  /** Member name (e.g. `params`, `onDispose`). */
  name: string;
  /** Whether it is a method or a (possibly object-valued) property. */
  kind: 'method' | 'property';
  /** True when the member is permission-gated (optional in the contract). */
  optional: boolean;
}

/** Extract the balanced body of `interface <name> {` from `dts`, or `''`. */
function interfaceBody(dts: string, name: string): string {
  const marker = `interface ${name} {`;
  const start = dts.indexOf(marker);
  if (start < 0) return '';
  let depth = 0;
  const open = dts.indexOf('{', start);
  for (let i = open; i < dts.length; i++) {
    const ch = dts[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return dts.slice(open + 1, i);
    }
  }
  return '';
}

/** Match a top-level member: exactly two leading spaces, then `name` / `name?` then `:`/`(`. */
const TOP_LEVEL_MEMBER = /^ {2}([A-Za-z_$][\w$]*)(\??)\s*([:(])/;

/**
 * Extract the top-level members of the `ExtContext` interface from a bundled
 * `.d.ts`. Returns an empty array when the interface is absent. Order follows
 * the declaration; duplicates are removed.
 */
export function extractApiMembers(dts: string, interfaceName = 'ExtContext'): ApiMember[] {
  const body = interfaceBody(dts, interfaceName);
  if (!body) return [];
  const seen = new Set<string>();
  const members: ApiMember[] = [];
  for (const line of body.split('\n')) {
    const m = TOP_LEVEL_MEMBER.exec(line);
    if (!m) continue;
    const name = m[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    members.push({ name, kind: m[3] === '(' ? 'method' : 'property', optional: m[2] === '?' });
  }
  return members;
}
