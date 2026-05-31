/**
 * Gauge registry + selection (task T2.2; spec plan/04 §4.2 "configurable
 * gauges/cards"). A flat, ordered list of every gauge so a container (the
 * Flight instruments rail, T2.11) can pick which to show per a saved selection.
 *
 * Pure data + lookup helpers (no DOM) so the selection logic is unit-testable.
 */
import type { Component } from 'solid-js';
import { AttitudeGauge, CompassGauge, VsiGauge } from './canvas-gauges';
import {
  AirspeedGauge,
  BatteryGauge,
  EkfGauge,
  GpsGauge,
  LinkGauge,
  NavGauge,
  RcGauge,
  SystemGauge,
  VibeGauge,
} from './value-cards';
import type { GaugeProps } from './types';

/** A registered gauge: stable id, title key, render kind and its component. */
export interface GaugeDescriptor {
  /** Stable id used in saved selections (e.g. workspaces/settings). */
  id: string;
  /** i18n key for the gauge title. */
  labelKey: string;
  /** `canvas` dials vs DOM value `card`s. */
  kind: 'canvas' | 'card';
  /** The Solid component to mount. */
  component: Component<GaugeProps>;
}

/** Every gauge, in a sensible default display order. */
export const GAUGES: readonly GaugeDescriptor[] = [
  { id: 'attitude', labelKey: 'gauges.attitude.title', kind: 'canvas', component: AttitudeGauge },
  { id: 'compass', labelKey: 'gauges.compass.title', kind: 'canvas', component: CompassGauge },
  { id: 'vsi', labelKey: 'gauges.vsi.title', kind: 'canvas', component: VsiGauge },
  { id: 'airspeed', labelKey: 'gauges.airspeed.title', kind: 'card', component: AirspeedGauge },
  { id: 'battery', labelKey: 'gauges.battery.title', kind: 'card', component: BatteryGauge },
  { id: 'gps', labelKey: 'gauges.gps.title', kind: 'card', component: GpsGauge },
  { id: 'ekf', labelKey: 'gauges.ekf.title', kind: 'card', component: EkfGauge },
  { id: 'vibe', labelKey: 'gauges.vibe.title', kind: 'card', component: VibeGauge },
  { id: 'rc', labelKey: 'gauges.rc.title', kind: 'card', component: RcGauge },
  { id: 'system', labelKey: 'gauges.system.title', kind: 'card', component: SystemGauge },
  { id: 'link', labelKey: 'gauges.link.title', kind: 'card', component: LinkGauge },
  { id: 'nav', labelKey: 'gauges.nav.title', kind: 'card', component: NavGauge },
];

/** Default selection: every gauge, in registry order. */
export const DEFAULT_GAUGE_SELECTION: readonly string[] = GAUGES.map((g) => g.id);

const BY_ID: ReadonlyMap<string, GaugeDescriptor> = new Map(GAUGES.map((g) => [g.id, g]));

/** Look up a gauge descriptor by id. */
export function getGauge(id: string): GaugeDescriptor | undefined {
  return BY_ID.get(id);
}

/**
 * Resolve an ordered selection of ids to descriptors, preserving the requested
 * order and silently skipping unknown ids. Omitting `ids` yields every gauge.
 */
export function resolveSelection(ids?: readonly string[]): GaugeDescriptor[] {
  if (ids === undefined) return [...GAUGES];
  const out: GaugeDescriptor[] = [];
  for (const id of ids) {
    const d = BY_ID.get(id);
    if (d !== undefined) out.push(d);
  }
  return out;
}
