/**
 * Public surface of the reactive application store (impl 03 T0.5). Cross-module
 * consumers import from here, never from deep paths (conventions
 * plan/implementation/00 §0.3). The state types themselves live in the frozen
 * `src/contracts/store.ts` seam and are re-exported through `@/contracts`.
 */
export { createAppStore } from './app-store';
export { createDefaultAppState, mergeAppState } from './app-state';
