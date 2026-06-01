/**
 * Minimal ambient declarations for the node builtins used by the file-scanning
 * meta-tests (a11y-audit, a11y-rtl). Deliberately SCOPED — we do NOT pull in
 * `@types/node`'s global augmentations (which would override the DOM `setTimeout`
 * return type with `Timeout` and break browser-typed code like transport-replay).
 * Node-environment integration/perf suites use their own tsconfig (excluded from
 * the root). This only declares what these repo-scanning tests actually call.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  interface Dirent {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readdirSync(path: string): string[];
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string;
}

declare const process: { readonly cwd: () => string };
