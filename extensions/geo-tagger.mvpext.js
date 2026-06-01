/**
 * Geo-tagger — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - combine MAVLink event telemetry with the active vehicle GPS snapshot;
 * - write namespaced extension data through `ctx.storage`;
 * - keep async event work fire-and-forget but error-visible through `ctx.log`.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'org.mvplanner.examples.geo-tagger',
  name: 'Geo-tagger',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Stores camera-trigger events with GPS for survey post-processing.',
  author: 'MVPlanner',
  permissions: ['telemetry:read', 'storage'],
  contributes: {
    settings: [{ id: 'geo-tagger.log', title: 'Camera trigger geo-tag log' }],
  },
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  const off = ctx.mavlink.on('CAMERA_TRIGGER', (message) => {
    void (async () => {
      const vehicle = ctx.vehicles.active();
      const position = vehicle.position;
      if (!position) {
        ctx.log.warn('Geo-tagger skipped camera trigger without vehicle GPS', message.fields);
        return;
      }
      const seq = toNumber(message.fields.seq) ?? toNumber(message.fields.sequence) ?? 0;
      const event = {
        seq,
        rxTimeUs: message.rxTimeUs,
        lat: position.lat,
        lon: position.lon,
        altM: position.altRelM,
      };
      const events = (await ctx.storage.get('camera-tags')) ?? [];
      events.push(event);
      await ctx.storage.set('camera-tags', events.slice(-500));
      ctx.log.info('Geo-tagged camera trigger', event);
    })().catch((error) => ctx.log.error('Geo-tagger failed', error));
  });
  ctx.onDispose(off);
}

export function deactivate() {}
