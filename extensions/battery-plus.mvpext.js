/**
 * Battery+ panel — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - declare only telemetry, panel, and notification permissions;
 * - register a panel implementation at activation time;
 * - subscribe to MAVLink `SYS_STATUS` and clean it up through `ctx.onDispose`.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 * @typedef {import('../src/contracts').DecodedMessage} DecodedMessage
 */

export const manifest = {
  id: 'org.mvplanner.examples.battery-plus',
  name: 'Battery+ Panel',
  version: '1.0.0',
  apiVersion: '^1.0',
  description:
    'Shows battery voltage/current/Wh/% and warns when SYS_STATUS crosses low thresholds.',
  author: 'MVPlanner',
  permissions: ['telemetry:read', 'ui:panel', 'notify'],
  contributes: {
    panels: [{ id: 'battery-plus', title: 'Battery+', icon: 'battery' }],
  },
};

const numberField = (message, name) => {
  const value = message.fields[name];
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  let panelEl;
  const state = { voltageV: 0, currentA: undefined, wh: undefined, remainingPct: undefined };
  let warned = false;
  const render = () => {
    if (!panelEl) return;
    const current = state.currentA === undefined ? '—' : `${state.currentA.toFixed(1)} A`;
    const wh = state.wh === undefined ? '—' : `${state.wh.toFixed(1)} Wh`;
    const pct = state.remainingPct === undefined ? '—' : `${state.remainingPct}%`;
    panelEl.textContent = `Voltage ${state.voltageV.toFixed(2)} V · Current ${current} · Used ${wh} · Remaining ${pct}`;
  };
  const panelOff = ctx.ui?.registerPanel({
    id: 'battery-plus',
    title: 'Battery+',
    icon: 'battery',
    mount(el) {
      panelEl = el;
      render();
      return () => {
        if (panelEl === el) panelEl = undefined;
      };
    },
  });
  if (panelOff) ctx.onDispose(panelOff);
  const off = ctx.mavlink.on(
    'SYS_STATUS',
    (message) => {
      const voltageMv = numberField(message, 'voltage_battery') ?? 0;
      const currentCa = numberField(message, 'current_battery');
      const usedMah = numberField(message, 'current_consumed');
      const remaining = numberField(message, 'battery_remaining');
      state.voltageV = voltageMv / 1000;
      state.currentA = currentCa === undefined || currentCa < 0 ? undefined : currentCa / 100;
      state.wh =
        usedMah === undefined || usedMah < 0 ? undefined : (state.voltageV * usedMah) / 1000;
      state.remainingPct = remaining === undefined || remaining < 0 ? undefined : remaining;
      if (!warned && (state.voltageV < 10.5 || (state.remainingPct ?? 100) <= 20)) {
        warned = true;
        ctx.notify.warn(
          `Low battery: ${state.voltageV.toFixed(2)} V, ${state.remainingPct ?? '?'}% remaining`,
        );
      }
      render();
    },
    { rateHz: 1 },
  );
  ctx.onDispose(off);
}

export function deactivate() {}
