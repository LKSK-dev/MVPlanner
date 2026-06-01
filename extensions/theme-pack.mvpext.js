/**
 * Theme pack — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - `ctx.theme.register` is exposed with the UI permission because it changes shell UI;
 * - theme contribution metadata is declarative, while token registration is runtime code;
 * - the returned disposer is registered with `ctx.onDispose` for hot reload safety.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'org.mvplanner.examples.theme-pack',
  name: 'Field Night Theme Pack',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Registers a high-contrast field/night token set.',
  author: 'MVPlanner',
  permissions: ['ui:panel'],
  contributes: {
    themes: [{ id: 'field-night', title: 'Field Night' }],
  },
};

const tokens = {
  id: 'field-night',
  name: 'Field Night',
  colors: {
    background: '#06120f',
    panel: '#0b211b',
    text: '#eafff7',
    accent: '#00f5a0',
    warning: '#ffcc00',
  },
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  const off = ctx.theme?.register(tokens);
  if (off) ctx.onDispose(off);
}

export function deactivate() {}
