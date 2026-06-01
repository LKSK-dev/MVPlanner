/**
 * Extension runtime seam + trivial in-process runtime (task T7.1; spec plan/06
 * §6.3/§6.6).
 *
 * The {@link ExtensionRuntime} interface is the swap point for T7.2: the host
 * only ever talks to a runtime through `load(record) -> LoadedExtension`, so the
 * sandboxed Worker/iframe runtime can replace the trivial in-process one here
 * without touching the host. The in-process runtime is **eval-free**: it runs a
 * pre-provided module object `{ manifest, activate, deactivate }`, which keeps
 * the whole host unit-testable. Evaluating a code string into a module is the
 * sandbox's job (T7.2).
 */
import type { ExtContext, ExtManifest } from '../../contracts';
import { ExtManifestError } from './errors';

/** The shape a single-file `.mvpext.js` exports / a trusted module provides. */
export interface ExtModule {
  manifest: ExtManifest;
  activate?: (ctx: ExtContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/** What the host hands a runtime to load. `module` is present for in-process. */
export interface ExtLoadRecord {
  id: string;
  manifest: ExtManifest;
  /** Raw source, persisted for the sandboxed runtime (T7.2). */
  code: string;
  /** Pre-provided module for the in-process runtime; absent when sandboxed. */
  module?: ExtModule;
}

/** A runtime-loaded extension the host drives through its lifecycle. */
export interface LoadedExtension {
  activate(ctx: ExtContext): Promise<void>;
  deactivate(): Promise<void>;
  /** Release runtime-level resources (terminate worker/iframe in T7.2). */
  dispose(): Promise<void>;
}

/** The seam the sandbox (T7.2) swaps in; the host depends only on this. */
export interface ExtensionRuntime {
  load(record: ExtLoadRecord): Promise<LoadedExtension>;
}

/**
 * Trivial, eval-free in-process runtime: drives the module object carried on the
 * load record. Throws if no module is present (e.g. a record restored from
 * storage with only `code` — that path is the sandbox's, T7.2).
 */
export function createInProcessRuntime(): ExtensionRuntime {
  return {
    load(record: ExtLoadRecord): Promise<LoadedExtension> {
      const mod = record.module;
      if (!mod) {
        throw new ExtManifestError(
          `in-process runtime requires a module for extension "${record.id}" (code-string loading is the sandbox runtime, T7.2)`,
        );
      }
      let activated = false;
      const loaded: LoadedExtension = {
        async activate(ctx: ExtContext): Promise<void> {
          if (mod.activate) await mod.activate(ctx);
          activated = true;
        },
        async deactivate(): Promise<void> {
          if (activated && mod.deactivate) await mod.deactivate();
          activated = false;
        },
        async dispose(): Promise<void> {
          // In-process: nothing to release (no worker/iframe to terminate).
        },
      };
      return Promise.resolve(loaded);
    },
  };
}
