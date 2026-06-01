/**
 * Custom NMEA/ADSB map layer — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - `ctx.map.addLayer` registers a live overlay and returns a disposer;
 * - MAVLink telemetry acts as the custom data source for ownship + ADS-B targets;
 * - the renderer receives only a canvas/project API, keeping map internals isolated.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'org.mvplanner.examples.custom-nmea-adsb-layer',
  name: 'Custom NMEA/ADSB Layer',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Draws ownship and ADS-B targets from telemetry as a custom map layer.',
  author: 'MVPlanner',
  permissions: ['map', 'telemetry:read'],
  contributes: {
    mapLayers: [{ id: 'examples.adsb-nmea', title: 'Example ADS-B / NMEA overlay' }],
  },
};

const scaled = (value, scale) => {
  const number = Number(value);
  return Number.isFinite(number) ? number / scale : undefined;
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  if (!ctx.map) return;
  let ownship;
  const targets = new Map();
  const renderPoint = (mapCtx, point, color, radius) => {
    const canvasCtx = mapCtx.canvas.getContext('2d');
    if (!canvasCtx) return;
    const [x, y] = mapCtx.project(point.lat, point.lon);
    canvasCtx.fillStyle = color;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, radius, 0, Math.PI * 2);
    canvasCtx.fill();
  };
  const layerOff = ctx.map.addLayer({
    id: 'examples.adsb-nmea',
    render(mapCtx) {
      if (ownship) renderPoint(mapCtx, ownship, '#00d4ff', 5);
      for (const target of targets.values()) renderPoint(mapCtx, target, '#ffb000', 3);
    },
  });
  const ownOff = ctx.mavlink.on('GLOBAL_POSITION_INT', (message) => {
    const lat = scaled(message.fields.lat, 1e7);
    const lon = scaled(message.fields.lon, 1e7);
    if (lat !== undefined && lon !== undefined) ownship = { lat, lon };
  });
  const adsbOff = ctx.mavlink.on('ADSB_VEHICLE', (message) => {
    const lat = scaled(message.fields.lat, 1e7);
    const lon = scaled(message.fields.lon, 1e7);
    const icao = String(message.fields.ICAO_address ?? message.fields.icao_address ?? 'unknown');
    if (lat !== undefined && lon !== undefined) targets.set(icao, { lat, lon });
  });
  ctx.onDispose(layerOff);
  ctx.onDispose(ownOff);
  ctx.onDispose(adsbOff);
}

export function deactivate() {}
