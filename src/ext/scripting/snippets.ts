/**
 * Snippet store (task T7.4; spec plan/06 §6.7 "save scripts … export/import").
 *
 * A thin, async CRUD layer over an injected {@link KvStore}: named scripts are
 * persisted as one record under a single KV key (read-modify-write per op, so
 * it stays correct without a cache). Pure aside from the injected store, so it
 * unit-tests against an in-memory fake KV. {@link SnippetStore.export} /
 * {@link SnippetStore.import} round-trip a stable JSON envelope.
 */
import type { KvStore } from '../../contracts';
import type { Snippet, SnippetInput, SnippetsExport } from './types';

/** Default KV namespace + key for persisted snippets. */
const DEFAULT_NAMESPACE = 'scripting';
const SNIPPETS_KEY = 'snippets';

/** Injected dependencies for {@link createSnippetStore}. */
export interface SnippetStoreDeps {
  /** Backing KV store. */
  storage: KvStore;
  /** KV namespace (default `'scripting'`). */
  namespace?: string;
  /** Clock for `createdMs`/`updatedMs` (deterministic tests). */
  now?: () => number;
  /** Id generator for new snippets (deterministic tests). */
  genId?: () => string;
}

/** Persisted, named-script CRUD + export/import. */
export interface SnippetStore {
  /** All snippets, sorted by name (case-insensitive). */
  list(): Promise<Snippet[]>;
  /** One snippet by id, or `undefined`. */
  get(id: string): Promise<Snippet | undefined>;
  /** Create (no `id`) or update (with `id`) a snippet; returns the stored record. */
  save(input: SnippetInput): Promise<Snippet>;
  /** Delete a snippet by id (no-op if absent). */
  remove(id: string): Promise<void>;
  /** Remove every snippet. */
  clear(): Promise<void>;
  /** Export all snippets as a JSON envelope. */
  export(): Promise<SnippetsExport>;
  /**
   * Import snippets from an {@link SnippetsExport}-shaped value. Existing ids are
   * preserved (overwriting matches); malformed entries are skipped. Returns the
   * imported snippets.
   */
  import(data: unknown): Promise<Snippet[]>;
}

/** Random, collision-resistant id. */
function defaultGenId(): string {
  return `snip_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Type guard for a stored snippet record. */
function isSnippet(v: unknown): v is Snippet {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.code === 'string' &&
    typeof s.createdMs === 'number' &&
    typeof s.updatedMs === 'number'
  );
}

/** Build a {@link SnippetStore} over the injected KV store. */
export function createSnippetStore(deps: SnippetStoreDeps): SnippetStore {
  const ns = deps.namespace ?? DEFAULT_NAMESPACE;
  const now = deps.now ?? ((): number => Date.now());
  const genId = deps.genId ?? defaultGenId;

  const readAll = async (): Promise<Record<string, Snippet>> => {
    const raw = await deps.storage.get<Record<string, Snippet>>(ns, SNIPPETS_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  };
  const writeAll = (map: Record<string, Snippet>): Promise<void> =>
    deps.storage.set(ns, SNIPPETS_KEY, map);

  const sorted = (map: Record<string, Snippet>): Snippet[] =>
    Object.values(map).sort((a, b) => a.name.localeCompare(b.name));

  return {
    async list(): Promise<Snippet[]> {
      return sorted(await readAll());
    },
    async get(id): Promise<Snippet | undefined> {
      return (await readAll())[id];
    },
    async save(input): Promise<Snippet> {
      const map = await readAll();
      const ts = now();
      const existing = input.id ? map[input.id] : undefined;
      const snippet: Snippet = {
        id: existing?.id ?? input.id ?? genId(),
        name: input.name,
        code: input.code,
        createdMs: existing?.createdMs ?? ts,
        updatedMs: ts,
      };
      map[snippet.id] = snippet;
      await writeAll(map);
      return snippet;
    },
    async remove(id): Promise<void> {
      const map = await readAll();
      if (id in map) {
        delete map[id];
        await writeAll(map);
      }
    },
    async clear(): Promise<void> {
      await deps.storage.del(ns, SNIPPETS_KEY);
    },
    async export(): Promise<SnippetsExport> {
      return { kind: 'mvplanner.snippets', version: 1, snippets: sorted(await readAll()) };
    },
    async import(data): Promise<Snippet[]> {
      const incoming = (data as { snippets?: unknown })?.snippets;
      if (!Array.isArray(incoming)) return [];
      const map = await readAll();
      const imported: Snippet[] = [];
      for (const entry of incoming) {
        if (!isSnippet(entry)) continue;
        const snippet: Snippet = {
          id: entry.id,
          name: entry.name,
          code: entry.code,
          createdMs: entry.createdMs,
          updatedMs: entry.updatedMs,
        };
        map[snippet.id] = snippet;
        imported.push(snippet);
      }
      if (imported.length > 0) await writeAll(map);
      return imported;
    },
  };
}
