/**
 * Pure ADS-B map geometry (task T8.8). Converts traffic records into projected
 * screen targets, builds a heading-rotated aircraft icon and provides hit-test /
 * detail helpers that the Flight map assembly can use for hover and selection.
 */
import type { Project, ScreenPoint } from '../geometry';
import type { TrafficAircraft } from './store';

/** Projected ADS-B aircraft ready for canvas drawing or pointer hit-testing. */
export interface TrafficScreenTarget {
  /** Source traffic record. */
  aircraft: TrafficAircraft;
  /** Projected aircraft position. */
  center: ScreenPoint;
  /** Heading-rotated aircraft icon polygon. */
  icon: ScreenPoint[];
  /** Anchor used by the layer for text labels. */
  labelAnchor: ScreenPoint;
  /** Whether the target matches the current hover ICAO address. */
  hovered: boolean;
  /** Whether the target matches the current selected ICAO address. */
  selected: boolean;
}

/** Options for projecting ADS-B screen targets. */
export interface TrafficProjectionOptions {
  /** Icon length/width in pixels. */
  iconSizePx?: number;
  /** Current hover ICAO address, if any. */
  hoveredIcaoAddress?: number;
  /** Current selected ICAO address, if any. */
  selectedIcaoAddress?: number;
}

/** Human-readable details for a selected/hovered traffic target. */
export interface TrafficDetails {
  /** Title shown in a tooltip/popover. */
  title: string;
  /** Detail rows, already formatted for display. */
  rows: readonly string[];
}

/** Build a heading-rotated airplane glyph polygon centred on `center`. */
export function trafficIconPolygon(
  center: ScreenPoint,
  headingDeg: number,
  sizePx: number,
): ScreenPoint[] {
  const half = sizePx / 2;
  const local: ScreenPoint[] = [
    [0, -half],
    [half * 0.22, -half * 0.1],
    [half * 0.78, half * 0.05],
    [half * 0.18, half * 0.28],
    [half * 0.12, half],
    [0, half * 0.72],
    [-half * 0.12, half],
    [-half * 0.18, half * 0.28],
    [-half * 0.78, half * 0.05],
    [-half * 0.22, -half * 0.1],
  ];
  return local.map((p) => rotateAbout(center, p, headingDeg));
}

/** Project traffic records through the map engine `project()` seam. */
export function projectTrafficTargets(
  traffic: readonly TrafficAircraft[],
  project: Project,
  options: TrafficProjectionOptions = {},
): TrafficScreenTarget[] {
  const iconSizePx = options.iconSizePx ?? 24;
  return traffic.map((aircraft) => {
    const center = project(aircraft.lat, aircraft.lon);
    return {
      aircraft,
      center,
      icon: trafficIconPolygon(center, aircraft.headingDeg, iconSizePx),
      labelAnchor: [center[0] + iconSizePx * 0.55, center[1] - iconSizePx * 0.35],
      hovered: aircraft.icaoAddress === options.hoveredIcaoAddress,
      selected: aircraft.icaoAddress === options.selectedIcaoAddress,
    };
  });
}

/** Pick the nearest traffic target within `radiusPx` of a screen point. */
export function pickTrafficTarget(
  targets: readonly TrafficScreenTarget[],
  point: ScreenPoint,
  radiusPx = 18,
): TrafficScreenTarget | undefined {
  let best: TrafficScreenTarget | undefined;
  let bestDistance = radiusPx;
  for (const target of targets) {
    const d = Math.hypot(target.center[0] - point[0], target.center[1] - point[1]);
    if (d <= bestDistance) {
      best = target;
      bestDistance = d;
    }
  }
  return best;
}

/** One-line map label: callsign/ICAO plus altitude. */
export function trafficLabel(aircraft: TrafficAircraft): string {
  const name = aircraft.callsign || aircraft.icaoHex;
  return `${name} ${formatTrafficAltitude(aircraft.altitudeM)}`;
}

/** Format altitude for the ADS-B map label. */
export function formatTrafficAltitude(altitudeM: number): string {
  if (!Number.isFinite(altitudeM)) return '— m';
  return `${Math.round(altitudeM)} m`;
}

/** Build display-only details for a hover/selection popover. */
export function trafficDetails(
  aircraft: TrafficAircraft,
  nowMs: number = aircraft.receivedAtMs,
): TrafficDetails {
  const ageSec = Math.max(0, Math.round((nowMs - aircraft.lastSeenMs) / 1000));
  return {
    title: aircraft.callsign || aircraft.icaoHex,
    rows: [
      `ICAO: ${aircraft.icaoHex}`,
      `Altitude: ${formatTrafficAltitude(aircraft.altitudeM)}`,
      `Heading: ${Math.round(aircraft.headingDeg)}°`,
      `Ground speed: ${aircraft.horizontalVelocityMps.toFixed(1)} m/s`,
      `Last seen: ${ageSec} s ago`,
      `Emitter: ${aircraft.emitterType}`,
    ],
  };
}

function rotateAbout(center: ScreenPoint, offset: ScreenPoint, deg: number): ScreenPoint {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [x, y] = offset;
  return [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
}
