/**
 * Macro store + binding (task T7.4; spec plan/06 §6.7 "bind to commands /
 * shortcuts / buttons, run on events").
 *
 * {@link createMacroStore} is a KV-backed CRUD layer (mirrors the snippet
 * store). {@link bindMacros} is the PURE wiring that turns saved macros into
 * live triggers: command/shortcut macros register on the {@link UiRegistry}
 * (so they appear in the palette), event macros subscribe to an injected event
 * source ("run on connect" etc.), and button macros are surfaced by the console
 * UI (no host binding). The actual execution is delegated to an injected
 * `run(macro)` so the binder needs no editor or engine and unit-tests cleanly.
 */
import type { CommandDef, KvStore, UiRegistry } from '../../contracts';
import type { Macro, MacroInput, MacrosExport } from './types';

/** Default KV namespace + key for persisted macros. */
const DEFAULT_NAMESPACE = 'scripting';
const MACROS_KEY = 'macros';

/** Injected dependencies for {@link createMacroStore}. */
export interface MacroStoreDeps {
  storage: KvStore;
  namespace?: string;
  genId?: () => string;
}

/** Persisted macro CRUD + export/import. */
export interface MacroStore {
  list(): Promise<Macro[]>;
  get(id: string): Promise<Macro | undefined>;
  save(input: MacroInput): Promise<Macro>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  export(): Promise<MacrosExport>;
  import(data: unknown): Promise<Macro[]>;
}

function defaultGenId(): string {
  return `macro_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function isMacro(v: unknown): v is Macro {
  if (v === null || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.enabled !== 'boolean') {
    return false;
  }
  const trigger = m.trigger as { kind?: unknown } | null;
  return (
    trigger !== null &&
    typeof trigger === 'object' &&
    (trigger.kind === 'command' || trigger.kind === 'event' || trigger.kind === 'button')
  );
}

/** Build a {@link MacroStore} over the injected KV store. */
export function createMacroStore(deps: MacroStoreDeps): MacroStore {
  const ns = deps.namespace ?? DEFAULT_NAMESPACE;
  const genId = deps.genId ?? defaultGenId;

  const readAll = async (): Promise<Record<string, Macro>> => {
    const raw = await deps.storage.get<Record<string, Macro>>(ns, MACROS_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  };
  const writeAll = (map: Record<string, Macro>): Promise<void> =>
    deps.storage.set(ns, MACROS_KEY, map);

  const normalize = (input: MacroInput, id: string): Macro => ({
    id,
    name: input.name,
    trigger: input.trigger,
    enabled: input.enabled ?? true,
    ...(input.snippetId !== undefined ? { snippetId: input.snippetId } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
  });

  return {
    async list(): Promise<Macro[]> {
      return Object.values(await readAll()).sort((a, b) => a.name.localeCompare(b.name));
    },
    async get(id): Promise<Macro | undefined> {
      return (await readAll())[id];
    },
    async save(input): Promise<Macro> {
      const map = await readAll();
      const id = input.id ?? genId();
      const macro = normalize(input, id);
      map[macro.id] = macro;
      await writeAll(map);
      return macro;
    },
    async remove(id): Promise<void> {
      const map = await readAll();
      if (id in map) {
        delete map[id];
        await writeAll(map);
      }
    },
    async clear(): Promise<void> {
      await deps.storage.del(ns, MACROS_KEY);
    },
    async export(): Promise<MacrosExport> {
      return { kind: 'mvplanner.macros', version: 1, macros: Object.values(await readAll()) };
    },
    async import(data): Promise<Macro[]> {
      const incoming = (data as { macros?: unknown })?.macros;
      if (!Array.isArray(incoming)) return [];
      const map = await readAll();
      const imported: Macro[] = [];
      for (const entry of incoming) {
        if (!isMacro(entry)) continue;
        map[entry.id] = entry;
        imported.push(entry);
      }
      if (imported.length > 0) await writeAll(map);
      return imported;
    },
  };
}

/** The event source `bind` subscribes "run on event" macros to. */
export interface MacroEventSource {
  on(event: string, cb: () => void): () => void;
}

/** Injected dependencies for {@link bindMacros}. */
export interface BindMacrosDeps {
  /** Command palette registry — command-triggered macros register here. */
  registry: Pick<UiRegistry, 'registerCommand'>;
  /** Run a macro (resolve its code + execute via the engine; injected by the controller). */
  run: (macro: Macro) => void | Promise<void>;
  /** Optional event source for "run on event" macros (e.g. the app event bus). */
  events?: MacroEventSource;
}

/**
 * Bind every enabled macro to its trigger and return a disposer that unbinds
 * them all. Command macros register a palette {@link CommandDef}; event macros
 * subscribe on `events`; button macros are intentionally not bound here (the
 * console UI renders their buttons).
 */
export function bindMacros(macros: readonly Macro[], deps: BindMacrosDeps): () => void {
  const disposers: Array<() => void> = [];
  for (const macro of macros) {
    if (!macro.enabled) continue;
    const trigger = macro.trigger;
    if (trigger.kind === 'command') {
      const def: CommandDef = {
        id: trigger.commandId,
        title: trigger.title,
        run: () => deps.run(macro),
        ...(trigger.shortcut !== undefined ? { shortcut: trigger.shortcut } : {}),
      };
      disposers.push(deps.registry.registerCommand(def));
    } else if (trigger.kind === 'event' && deps.events) {
      disposers.push(
        deps.events.on(trigger.event, () => {
          void deps.run(macro);
        }),
      );
    }
  }
  return (): void => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
  };
}
