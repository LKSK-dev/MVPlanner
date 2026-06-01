/**
 * Auto-test script pack — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - extensions can compose telemetry reads with command APIs for repeatable SITL checks;
 * - this demo is intentionally safe: it only re-sends the current mode on explicit event;
 * - use `ctx.events` for script triggers without requiring UI permissions.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'org.mvplanner.examples.auto-test-script-pack',
  name: 'Auto-test Script Pack',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Provides safe SITL smoke-test sequences triggered by the extension event bus.',
  author: 'MVPlanner',
  permissions: ['command', 'telemetry:read'],
  contributes: {
    settings: [{ id: 'auto-test.safe-smoke', title: 'Run event: mvplanner.examples.autotest.run' }],
  },
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  const off = ctx.events.on('mvplanner.examples.autotest.run', () => {
    void (async () => {
      const vehicle = ctx.vehicles.active();
      ctx.mavlink.requestInterval('HEARTBEAT', 1);
      await ctx.command?.setMode(vehicle.mode);
      ctx.events.emit('mvplanner.examples.autotest.done', {
        mode: vehicle.mode,
        armed: vehicle.armed,
        safeDemo: true,
      });
      ctx.log.info('Safe SITL smoke sequence completed', vehicle.mode);
    })().catch((error) => ctx.log.error('Safe SITL smoke sequence failed', error));
  });
  ctx.onDispose(off);
}

export function deactivate() {}
