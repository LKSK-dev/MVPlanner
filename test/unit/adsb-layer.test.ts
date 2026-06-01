/** Unit tests for ADS-B map layer pure geometry and canvas-deferred rendering. */
import { describe, expect, it, vi } from 'vitest';
import type { MapLayer, MapRenderCtx } from '../../src/contracts';
import type { Project } from '../../src/ui/widgets/map/layers';
import {
  createAdsbTrafficLayer,
  pickTrafficTarget,
  projectTrafficTargets,
  trafficDetails,
  trafficIconPolygon,
  trafficLabel,
  type TrafficAircraft,
} from '../../src/ui/widgets/map/layers/adsb';

const aircraft: TrafficAircraft = {
  icaoAddress: 0xabc123,
  icaoHex: 'ABC123',
  lat: 10,
  lon: 20,
  altitudeM: 1200.4,
  headingDeg: 90,
  horizontalVelocityMps: 30.5,
  callsign: 'N123AB',
  emitterType: 1,
  tslcSec: 3,
  flags: 31,
  receivedAtMs: 10_000,
  lastSeenMs: 7_000,
};

function stubCtx(project: Project = (lat, lon) => [lon, lat]): {
  ctx: MapRenderCtx;
  project: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn<Project>(project);
  const canvas = { getContext: (): null => null } as unknown as HTMLCanvasElement;
  return { ctx: { canvas, project: spy as unknown as Project }, project: spy };
}

function renderLayer(layer: MapLayer, project?: Project): ReturnType<typeof vi.fn> {
  const { ctx, project: spy } = stubCtx(project);
  layer.render(ctx);
  return spy;
}

describe('ADS-B traffic geometry', () => {
  it('builds a heading-rotated aircraft icon', () => {
    const north = trafficIconPolygon([100, 100], 0, 20);
    const east = trafficIconPolygon([100, 100], 90, 20);
    const northNose = north[0];
    const eastNose = east[0];
    expect(northNose).toBeDefined();
    expect(eastNose).toBeDefined();
    if (!northNose || !eastNose) throw new Error('expected icon noses');
    expect(northNose[0]).toBeCloseTo(100, 6);
    expect(northNose[1]).toBeCloseTo(90, 6);
    expect(eastNose[0]).toBeCloseTo(110, 6);
    expect(eastNose[1]).toBeCloseTo(100, 6);
  });

  it('projects traffic and marks hover/selection state', () => {
    const project = vi.fn<Project>((lat, lon) => [lon * 2, lat * 3]);
    const targets = projectTrafficTargets([aircraft], project, {
      iconSizePx: 20,
      hoveredIcaoAddress: aircraft.icaoAddress,
      selectedIcaoAddress: aircraft.icaoAddress,
    });
    expect(project).toHaveBeenCalledWith(10, 20);
    const target = targets[0];
    expect(target).toBeDefined();
    if (!target) throw new Error('expected projected target');
    expect(target.center).toEqual([40, 30]);
    expect(target.hovered).toBe(true);
    expect(target.selected).toBe(true);
  });

  it('picks nearest targets and formats labels/details', () => {
    const targets = projectTrafficTargets([aircraft], (lat, lon) => [lon, lat]);
    expect(pickTrafficTarget(targets, [21, 11], 5)?.aircraft.icaoHex).toBe('ABC123');
    expect(pickTrafficTarget(targets, [100, 100], 5)).toBeUndefined();
    expect(trafficLabel(aircraft)).toBe('N123AB 1200 m');
    expect(trafficDetails(aircraft, 13_000)).toEqual({
      title: 'N123AB',
      rows: [
        'ICAO: ABC123',
        'Altitude: 1200 m',
        'Heading: 90°',
        'Ground speed: 30.5 m/s',
        'Last seen: 6 s ago',
        'Emitter: 1',
      ],
    });
  });
});

describe('ADS-B traffic layer', () => {
  it('projects each aircraft before deferring canvas drawing', () => {
    const project = renderLayer(createAdsbTrafficLayer(() => [aircraft]));
    expect(project).toHaveBeenCalledTimes(1);
    expect(project).toHaveBeenCalledWith(10, 20);
  });

  it('draws nothing when traffic is empty or absent', () => {
    expect(renderLayer(createAdsbTrafficLayer(() => []))).not.toHaveBeenCalled();
    expect(renderLayer(createAdsbTrafficLayer(() => undefined))).not.toHaveBeenCalled();
  });
});
