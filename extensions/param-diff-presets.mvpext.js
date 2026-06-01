/**
 * Param diff / preset manager — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - a manifest declares panel and command metadata, while activation registers implementations;
 * - telemetry read powers `params.fetchAll` and `params.onChange`;
 * - parameter writes are explicit, confirmable, and limited to the preset keys below.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'org.mvplanner.examples.param-diff-presets',
  name: 'Param Diff & Presets',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Shows vehicle parameter diffs and applies a tiny safe-demo preset.',
  author: 'MVPlanner',
  permissions: ['telemetry:read', 'params:write', 'ui:panel'],
  contributes: {
    panels: [{ id: 'param-diff', title: 'Param Diff', icon: 'sliders' }],
    commands: [
      { id: 'param-diff.refresh', title: 'Param Diff: Refresh' },
      { id: 'param-diff.apply-safe-gains', title: 'Param Diff: Apply safe demo gains' },
    ],
  },
};

const PRESET = { PSC_POSXY_P: 1, PSC_VELXY_P: 2 };

/** @param {ExtContext} ctx */
export function activate(ctx) {
  if (!ctx.ui || !ctx.params) return;
  let panelEl;
  const names = Object.keys(PRESET);
  const render = async () => {
    const values = new Map((await ctx.params.fetchAll()).map((param) => [param.name, param.value]));
    const diff = names.map((name) => `${name}: ${values.get(name) ?? 'missing'} → ${PRESET[name]}`);
    if (panelEl) panelEl.textContent = diff.join(' · ');
    ctx.log.info('Param preset diff', diff);
  };
  const panelOff = ctx.ui.registerPanel({
    id: 'param-diff',
    title: 'Param Diff',
    icon: 'sliders',
    mount(el) {
      panelEl = el;
      void render();
      return () => {
        if (panelEl === el) panelEl = undefined;
      };
    },
  });
  const refreshOff = ctx.ui.registerCommand({
    id: 'param-diff.refresh',
    title: 'Param Diff: Refresh',
    run: () => {
      void render();
    },
  });
  const applyOff = ctx.ui.registerCommand({
    id: 'param-diff.apply-safe-gains',
    title: 'Param Diff: Apply safe demo gains',
    run: async () => {
      if (
        !(await ctx.ui.confirm({
          title: 'Apply demo preset?',
          body: names.join(', '),
          armedAware: true,
        }))
      )
        return;
      for (const name of names) await ctx.params.set(name, PRESET[name]);
      await render();
    },
  });
  const changeOff = ctx.params.onChange(() => {
    void render();
  });
  ctx.onDispose(panelOff);
  ctx.onDispose(refreshOff);
  ctx.onDispose(applyOff);
  ctx.onDispose(changeOff);
}

export function deactivate() {}
