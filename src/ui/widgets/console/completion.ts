/**
 * CodeMirror completion source for `mvp.` (task T7.4; spec plan/06 §6.7
 * "autocomplete from API types").
 *
 * Thin UI-layer wrapper over the pure {@link extractApiMembers} extractor: it
 * turns the bundled `.d.ts` (from {@link import('../../../ext/api').buildExtApiDts})
 * into a best-effort static completion that surfaces the top-level `mvp` member
 * names after a `mvp.` token, plus a base `mvp` completion at an identifier.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { extractApiMembers } from '../../../ext/scripting';

/** A CodeMirror completion source function. */
export type ConsoleCompletionSource = (context: CompletionContext) => CompletionResult | null;

/** Build member completions for the `mvp` surface from the bundled `.d.ts`. */
export function createMvpCompletionSource(apiDts: string): ConsoleCompletionSource {
  const members = extractApiMembers(apiDts);
  const memberOptions: Completion[] = members.map((m) => ({
    label: m.name,
    type: m.kind === 'method' ? 'method' : 'property',
    ...(m.optional ? { detail: 'permissioned' } : {}),
  }));
  const rootOptions: Completion[] = [{ label: 'mvp', type: 'variable', detail: 'extension API' }];

  return (context: CompletionContext): CompletionResult | null => {
    // After `mvp.` → member completions.
    const member = context.matchBefore(/mvp\.\w*/);
    if (member && memberOptions.length > 0) {
      return { from: member.from + 'mvp.'.length, options: memberOptions, validFor: /^\w*$/ };
    }
    // At a bare identifier → offer `mvp` itself (unless explicitly triggered).
    const word = context.matchBefore(/\w+/);
    if (word && (word.from !== word.to || context.explicit)) {
      return { from: word.from, options: rootOptions, validFor: /^\w*$/ };
    }
    return null;
  };
}
