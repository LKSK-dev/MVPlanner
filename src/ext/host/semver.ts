/**
 * Tiny dependency-free semver-range matcher (task T7.1; spec plan/06 §6.8).
 *
 * Just enough of the npm range grammar to gate an extension's `apiVersion`
 * against the host `EXT_API_VERSION`: exact versions, `*`/x-ranges, caret
 * (`^`), tilde (`~`), and space-separated AND comparators (`>= <= > < =`).
 * `||` (OR) ranges are intentionally **not** supported.
 *
 * Prerelease handling: ranges are compared on the `major.minor.patch` core
 * only; a version's prerelease tag is ignored for satisfaction. This makes a
 * pre-release host API (e.g. `1.0.0-pre`) behave like its release `1.0.0` for
 * compatibility checks, so `^1.0` extensions load against `1.0.0-pre`.
 */
import { ExtManifestError } from './errors';

/** A parsed semantic version (build metadata is discarded). */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

type ComparatorOp = '<' | '<=' | '>' | '>=' | '=';
interface Comparator {
  op: ComparatorOp;
  v: SemVer;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a full `x.y.z[-pre][+build]` version; throws {@link ExtManifestError}. */
export function parseSemVer(input: string): SemVer {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) throw new ExtManifestError(`invalid semantic version: "${input}"`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const prerelease = m[4];
  return prerelease !== undefined ? { major, minor, patch, prerelease } : { major, minor, patch };
}

/** Compare two versions on the `major.minor.patch` core (prerelease ignored). */
function compareCore(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** Parse a possibly-partial numeric version (missing/x parts -> 0), with a count. */
function parseLoose(input: string): { major: number; minor: number; patch: number; count: number } {
  const segs = input.split('.');
  const nums: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < 3; i++) {
    const seg = segs[i];
    if (seg === undefined || seg === '' || seg === 'x' || seg === 'X' || seg === '*') break;
    const n = Number(seg);
    if (!Number.isInteger(n) || n < 0) {
      throw new ExtManifestError(`invalid version range segment: "${input}"`);
    }
    nums[i] = n;
    count += 1;
  }
  return { major: nums[0], minor: nums[1], patch: nums[2], count };
}

/** Caret range `^a.b.c` -> `>=lower <upper` (left-most non-zero is pinned). */
function caretComparators(operand: string): Comparator[] {
  const { major, minor, patch, count } = parseLoose(operand);
  const lower: SemVer = { major, minor, patch };
  let upper: SemVer;
  if (major !== 0) upper = { major: major + 1, minor: 0, patch: 0 };
  else if (minor !== 0) upper = { major: 0, minor: minor + 1, patch: 0 };
  else if (patch !== 0) upper = { major: 0, minor: 0, patch: patch + 1 };
  else if (count <= 1) upper = { major: 1, minor: 0, patch: 0 };
  else if (count === 2) upper = { major: 0, minor: 1, patch: 0 };
  else upper = { major: 0, minor: 0, patch: 1 };
  return [
    { op: '>=', v: lower },
    { op: '<', v: upper },
  ];
}

/** Tilde range `~a.b.c` -> `>=lower <upper` (patch-level if minor specified). */
function tildeComparators(operand: string): Comparator[] {
  const { major, minor, patch, count } = parseLoose(operand);
  const lower: SemVer = { major, minor, patch };
  const upper: SemVer =
    count >= 2 ? { major, minor: minor + 1, patch: 0 } : { major: major + 1, minor: 0, patch: 0 };
  return [
    { op: '>=', v: lower },
    { op: '<', v: upper },
  ];
}

const isWild = (seg: string | undefined): boolean =>
  seg === undefined || seg === '' || seg === 'x' || seg === 'X' || seg === '*';

const toInt = (seg: string, token: string): number => {
  const n = Number(seg);
  if (!Number.isInteger(n) || n < 0) {
    throw new ExtManifestError(`invalid version range segment: "${token}"`);
  }
  return n;
};

/** Bare / x-range token (`1`, `1.2`, `1.x`, `1.2.3`) -> comparators. */
function xRangeComparators(token: string): Comparator[] {
  const segs = token.split('.');
  if (isWild(segs[0])) return [];
  const major = toInt(segs[0] as string, token);
  if (isWild(segs[1])) {
    return [
      { op: '>=', v: { major, minor: 0, patch: 0 } },
      { op: '<', v: { major: major + 1, minor: 0, patch: 0 } },
    ];
  }
  const minor = toInt(segs[1] as string, token);
  if (isWild(segs[2])) {
    return [
      { op: '>=', v: { major, minor, patch: 0 } },
      { op: '<', v: { major, minor: minor + 1, patch: 0 } },
    ];
  }
  const patch = toInt(segs[2] as string, token);
  return [{ op: '=', v: { major, minor, patch } }];
}

/** Operator comparator (`>=1.2.3`, partial operands fill missing parts with 0). */
function opComparator(op: ComparatorOp, operand: string): Comparator[] {
  const { major, minor, patch } = parseLoose(operand);
  return [{ op, v: { major, minor, patch } }];
}

/** Expand a single whitespace-delimited range token into comparators. */
function tokenComparators(token: string): Comparator[] {
  if (token === '' || token === '*' || token === 'x' || token === 'X') return [];
  if (token.startsWith('^')) return caretComparators(token.slice(1));
  if (token.startsWith('~')) return tildeComparators(token.slice(1));
  if (token.startsWith('>=')) return opComparator('>=', token.slice(2));
  if (token.startsWith('<=')) return opComparator('<=', token.slice(2));
  if (token.startsWith('>')) return opComparator('>', token.slice(1));
  if (token.startsWith('<')) return opComparator('<', token.slice(1));
  if (token.startsWith('=')) return opComparator('=', token.slice(1));
  return xRangeComparators(token);
}

function testComparator(v: SemVer, c: Comparator): boolean {
  const d = compareCore(v, c.v);
  switch (c.op) {
    case '<':
      return d < 0;
    case '<=':
      return d <= 0;
    case '>':
      return d > 0;
    case '>=':
      return d >= 0;
    case '=':
      return d === 0;
  }
}

/**
 * Does `version` satisfy `range`? `range` is a space-separated AND list of
 * comparators / caret / tilde / x-range tokens. Empty or `*` matches anything.
 *
 * @throws {@link ExtManifestError} when `version` or a range token is malformed.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseSemVer(version);
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') return true;
  const comparators: Comparator[] = [];
  for (const token of trimmed.split(/\s+/)) comparators.push(...tokenComparators(token));
  for (const c of comparators) {
    if (!testComparator(v, c)) return false;
  }
  return true;
}
