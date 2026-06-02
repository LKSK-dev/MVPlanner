/**
 * Hello World — first-party MVPlanner extension example & extension-system
 * sanity check.
 *
 * Tutorial points:
 * - the smallest possible UI extension: one permission (`ui:panel`) and a
 *   single clickable affordance that opens an overlay;
 * - `ctx.ui.addMenuItem('topbar', …)` contributes the small clickable box to
 *   the top-bar menu location; `ctx.ui.registerCommand(…)` exposes the same
 *   action in the command palette so it is reachable today;
 * - clicking either invokes `run()`, which shows a visible overlay via
 *   `ctx.ui.confirm({ title, body })` — the dialog/overlay seam exposed by the
 *   extension UI API (src/contracts/ui.ts `UiRegistry`);
 * - every registration returns a disposer wired through `ctx.onDispose` so the
 *   contribution is torn down on disable / hot reload.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  apiVersion: '^1.0',
  description:
    'Sanity-check extension: adds a small clickable "Hello" box that shows a "Hello World!" overlay.',
  author: 'MVPlanner',
  permissions: ['ui:panel'],
  contributes: {
    commands: [{ id: 'hello-world.greet', title: 'Hello' }],
  },
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  // Show the "Hello World!" overlay. `ctx.ui.confirm` is the only dialog/overlay
  // seam in the extension UI API (src/contracts/ui.ts); a toast would be the
  // fallback but the task prefers a visible overlay.
  const showGreeting = () => {
    void ctx.ui?.confirm({ title: 'Hello World!', body: 'Hello World!' });
  };

  const command = { id: 'hello-world.greet', title: 'Hello', run: showGreeting };

  // Command palette affordance (reachable today).
  const offCommand = ctx.ui?.registerCommand(command);
  if (offCommand) ctx.onDispose(offCommand);

  // The small clickable box contributed to the top-bar menu location.
  const offMenuItem = ctx.ui?.addMenuItem('topbar', command);
  if (offMenuItem) ctx.onDispose(offMenuItem);
}

export function deactivate() {}
