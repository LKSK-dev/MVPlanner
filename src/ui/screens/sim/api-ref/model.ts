/**
 * Pure extraction helpers for the in-app extension API reference (task T7.5).
 *
 * The API reference intentionally derives its member list from the shipped
 * declaration bundle plus the authoritative capability map, so docs, editor
 * autocomplete and permission gates stay aligned. This module is browser-free
 * and side-effect-free to keep the parsing and permission join unit-testable.
 */
import { CAPABILITY_MAP, type ApiMethodSpec } from '../../../../ext/api';
import type { Permission } from '../../../../contracts';

/** Display order for the primary API reference groups. */
export const API_REFERENCE_GROUP_ORDER = [
  'connection',
  'vehicles',
  'mavlink',
  'command',
  'params',
  'mission',
  'ui',
  'map',
  'storage',
  'files',
  'net',
  'notify',
  'log',
  'timers',
  'events',
  'theme',
  'transports',
  'lifecycle',
] as const;

/** A group key rendered by the API reference tree. */
export type ApiReferenceGroup = (typeof API_REFERENCE_GROUP_ORDER)[number];

/** Permission text joined from {@link CAPABILITY_MAP}. */
export type ApiReferencePermission = Permission | 'net:<host>' | null | undefined;

/** One extracted public API member. */
export interface ApiReferenceMember {
  /** Stable grouping bucket used by the tree/list. */
  readonly group: ApiReferenceGroup;
  /** Dotted member path without the `ctx.` prefix, e.g. `params.set`. */
  readonly path: string;
  /** Local member name, e.g. `set`. */
  readonly name: string;
  /** One-line callable/property signature prefixed with `ctx.`. */
  readonly signature: string;
  /** Leading TSDoc text parsed from the declaration, when present. */
  readonly description?: string;
  /** Required permission from the capability map (`null` means always available). */
  readonly permission: ApiReferencePermission;
}

interface ParsedStatementMember {
  readonly name: string;
  readonly signatureTail: string;
  readonly description?: string;
}

interface ExtractedMember extends ApiReferenceMember {
  readonly order: number;
}

/** Build API reference members from a `.d.ts` bundle and a capability map. */
export function extractApiReferenceMembers(
  dts: string,
  capabilityMap: readonly ApiMethodSpec[] = CAPABILITY_MAP,
): ApiReferenceMember[] {
  const extBody = findInterfaceBody(dts, 'ExtContext');
  if (extBody === undefined) return [];

  const permissionByMethod = new Map<string, ApiReferencePermission>();
  const orderByMethod = new Map<string, number>();
  capabilityMap.forEach((spec, index) => {
    permissionByMethod.set(spec.method, spec.net === true ? 'net:<host>' : spec.permission);
    orderByMethod.set(spec.method, index);
  });

  const members = new Map<string, ExtractedMember>();
  let order = capabilityMap.length;

  for (const statement of splitTopLevelStatements(extBody)) {
    const cleaned = stripComments(statement).trim();
    const topLevelName = parseTopLevelName(cleaned);
    if (topLevelName === undefined) continue;

    if (topLevelName === 'version' || topLevelName === 'onDispose') {
      const parsed = parseStatementMember(statement);
      if (parsed !== undefined) {
        const path = parsed.name;
        addMember(members, {
          group: 'lifecycle',
          path,
          name: parsed.name,
          signature: `ctx.${path}${parsed.signatureTail}`,
          ...(parsed.description !== undefined ? { description: parsed.description } : {}),
          permission: permissionByMethod.get(path),
          order: orderByMethod.get(path) ?? order++,
        });
      }
      continue;
    }

    for (const parsed of parseGroupMembers(dts, statement)) {
      const path = `${topLevelName}.${parsed.name}`;
      addMember(members, {
        group: groupForPath(path),
        path,
        name: parsed.name,
        signature: `ctx.${path}${parsed.signatureTail}`,
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        permission: permissionByMethod.get(path),
        order: orderByMethod.get(path) ?? order++,
      });
    }
  }

  return [...members.values()].sort(compareMembers).map(({ order: _order, ...member }) => member);
}

/** Renderable label for a joined permission requirement. */
export function formatApiReferencePermission(permission: ApiReferencePermission): string {
  if (permission === null) return 'None';
  if (permission === undefined) return 'Not listed';
  return permission;
}

/** Filter members by a user search query. */
export function filterApiReferenceMembers(
  members: readonly ApiReferenceMember[],
  query: string,
): ApiReferenceMember[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [...members];
  return members.filter((member) => {
    const haystack = [
      member.group,
      member.path,
      member.signature,
      member.description ?? '',
      formatApiReferencePermission(member.permission),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return haystack.includes(needle);
  });
}

function addMember(members: Map<string, ExtractedMember>, member: ExtractedMember): void {
  if (members.has(member.path)) return;
  members.set(member.path, member);
}

function compareMembers(a: ExtractedMember, b: ExtractedMember): number {
  const groupDelta = groupIndex(a.group) - groupIndex(b.group);
  if (groupDelta !== 0) return groupDelta;
  const orderDelta = a.order - b.order;
  if (orderDelta !== 0) return orderDelta;
  return a.path.localeCompare(b.path);
}

function groupIndex(group: ApiReferenceGroup): number {
  const index = API_REFERENCE_GROUP_ORDER.indexOf(group);
  return index === -1 ? API_REFERENCE_GROUP_ORDER.length : index;
}

function groupForPath(path: string): ApiReferenceGroup {
  const dot = path.indexOf('.');
  const root = dot === -1 ? path : path.slice(0, dot);
  if (root === 'logs' || root === 'log') return 'log';
  if (root === 'version' || root === 'onDispose') return 'lifecycle';
  if (isApiReferenceGroup(root)) return root;
  return 'lifecycle';
}

function isApiReferenceGroup(value: string): value is ApiReferenceGroup {
  return (API_REFERENCE_GROUP_ORDER as readonly string[]).includes(value);
}

function parseGroupMembers(dts: string, statement: string): ParsedStatementMember[] {
  const members: ParsedStatementMember[] = [];
  const beforeInlineObject = statement.split('{', 1)[0] ?? statement;

  for (const ref of findInterfaceRefs(beforeInlineObject)) {
    const body = findInterfaceBody(dts, ref);
    if (body !== undefined) members.push(...parseMemberStatements(body));
  }

  const inlineBody = extractFirstObjectBody(statement);
  if (inlineBody !== undefined) members.push(...parseMemberStatements(inlineBody));

  return members;
}

function findInterfaceRefs(statementPrefix: string): string[] {
  const ignored = new Set(['AbortSignal', 'Blob', 'Promise', 'Record', 'RequestInit', 'Response']);
  const refs: string[] = [];
  for (const match of statementPrefix.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
    const ref = match[0];
    if (!ignored.has(ref) && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

function parseMemberStatements(body: string): ParsedStatementMember[] {
  const members: ParsedStatementMember[] = [];
  for (const statement of splitTopLevelStatements(body)) {
    const parsed = parseStatementMember(statement);
    if (parsed !== undefined) members.push(parsed);
  }
  return members;
}

function parseStatementMember(statement: string): ParsedStatementMember | undefined {
  const description = parseTsdoc(statement);
  const cleaned = stripComments(statement).replace(/;\s*$/, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;

  const method = /^([A-Za-z_$][\w$]*)\??\s*(<[^>]+>)?\s*(\([\s\S]+)$/.exec(cleaned);
  if (method !== null) {
    const name = method[1];
    const typeParams = method[2] ?? '';
    const tail = method[3];
    if (name === undefined || tail === undefined) return undefined;
    return {
      name,
      signatureTail: `${typeParams}${tail}`,
      ...(description !== undefined ? { description } : {}),
    };
  }

  const property = /^([A-Za-z_$][\w$]*)\??\s*:\s*([\s\S]+)$/.exec(cleaned);
  if (property !== null) {
    const name = property[1];
    const type = property[2];
    if (name === undefined || type === undefined) return undefined;
    if (type.trim().startsWith('{')) return undefined;
    return {
      name,
      signatureTail: `: ${type.trim()}`,
      ...(description !== undefined ? { description } : {}),
    };
  }

  return undefined;
}

function parseTopLevelName(statement: string): string | undefined {
  const match = /^([A-Za-z_$][\w$]*)\??\s*(?:\(|:)/.exec(statement);
  return match?.[1];
}

function parseTsdoc(statement: string): string | undefined {
  const matches = [...statement.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  const last = matches[matches.length - 1];
  const body = last?.[1];
  if (body === undefined) return undefined;
  const text = body
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
    .replace(/\{@link\s+([^}]+)\}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : undefined;
}

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function findInterfaceBody(source: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:export\\s+)?interface\\s+${escapeRegex(name)}\\b`, 'm');
  const match = pattern.exec(source);
  if (match === null || match.index === undefined) return undefined;
  const open = source.indexOf('{', match.index + match[0].length);
  if (open === -1) return undefined;
  const close = findMatchingBrace(source, open);
  if (close === undefined) return undefined;
  return source.slice(open + 1, close);
}

function extractFirstObjectBody(source: string): string | undefined {
  const open = source.indexOf('{');
  if (open === -1) return undefined;
  const close = findMatchingBrace(source, open);
  if (close === undefined) return undefined;
  return source.slice(open + 1, close);
}

function splitTopLevelStatements(body: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let roundDepth = 0;
  let curlyDepth = 0;
  let squareDepth = 0;
  let lineComment = false;
  let blockComment = false;
  let quote: '"' | "'" | '`' | undefined;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (char === undefined) continue;

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') roundDepth += 1;
    else if (char === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (char === '{') curlyDepth += 1;
    else if (char === '}') curlyDepth = Math.max(0, curlyDepth - 1);
    else if (char === '[') squareDepth += 1;
    else if (char === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (char === ';' && roundDepth === 0 && curlyDepth === 0 && squareDepth === 0) {
      const statement = body.slice(start, index + 1).trim();
      if (statement.length > 0) statements.push(statement);
      start = index + 1;
    }
  }

  const rest = body.slice(start).trim();
  if (rest.length > 0) statements.push(rest);
  return statements;
}

function findMatchingBrace(source: string, openIndex: number): number | undefined {
  let depth = 0;
  let lineComment = false;
  let blockComment = false;
  let quote: '"' | "'" | '`' | undefined;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === undefined) continue;

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
