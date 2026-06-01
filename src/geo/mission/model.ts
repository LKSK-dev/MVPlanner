/**
 * The mission editing model operations + estimates (task T4.2; spec plan/04
 * §4.3). Pure: every helper returns a NEW {@link MissionModel} (or a plain
 * value) and never mutates its input, so reactive consumers (waypoint table
 * T4.3, map editing T4.4) can diff cheaply and undo/redo is trivial.
 */
import type { LatLon } from '../format';
import { commandHasPosition } from './commands';
import { DEFAULT_ALT_M } from './convert';
import { DEFAULT_MISSION_FRAME } from './frames';
import type { MissionEstimate, MissionItemModel, MissionModel, MissionType } from './types';

/** `MAV_CMD_NAV_WAYPOINT` — the default command for a new waypoint. */
export const NAV_WAYPOINT = 16;

/** Default cruise speed (m/s) used for the rough time estimate when none given. */
export const DEFAULT_CRUISE_MPS = 5;

const ZERO_PARAMS: readonly [number, number, number, number] = [0, 0, 0, 0];

/** Options for {@link createMission}. */
export interface CreateMissionOptions {
  /** Default altitude (metres) for new waypoints. Default {@link DEFAULT_ALT_M}. */
  defaultAlt?: number;
  /** Default `MAV_FRAME` for new waypoints. Default {@link DEFAULT_MISSION_FRAME}. */
  defaultFrame?: number;
}

/** Create an empty mission of `type` (default `'mission'`) with defaults applied. */
export function createMission(
  type: MissionType = 'mission',
  opts: CreateMissionOptions = {},
): MissionModel {
  return {
    type,
    items: [],
    defaultAlt: opts.defaultAlt ?? DEFAULT_ALT_M,
    defaultFrame: opts.defaultFrame ?? DEFAULT_MISSION_FRAME,
    currentSeq: 0,
  };
}

/** Clamp an insertion index into `[0, length]`. */
function clampInsert(index: number, length: number): number {
  if (index < 0) return 0;
  if (index > length) return length;
  return index;
}

/** Clamp an existing-item index into `[0, length - 1]` (or -1 when empty). */
function clampItem(index: number, length: number): number {
  if (length === 0) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/** Overrides for {@link addWaypoint} / {@link makeWaypoint}. */
export interface WaypointOptions {
  /** `MAV_CMD` command id. Default {@link NAV_WAYPOINT}. */
  command?: number;
  /** Altitude (metres). Default the model's `defaultAlt`. */
  alt?: number;
  /** `MAV_FRAME`. Default the model's `defaultFrame`. */
  frame?: number;
  /** `param1..param4`. Default all-zero. */
  params?: readonly [number, number, number, number];
  /** `autocontinue` flag. Default `true`. */
  autocontinue?: boolean;
}

/** Build a {@link MissionItemModel} at `point`, applying the model's defaults. */
export function makeWaypoint(
  model: MissionModel,
  point: LatLon,
  opts: WaypointOptions = {},
): MissionItemModel {
  return {
    command: opts.command ?? NAV_WAYPOINT,
    frame: opts.frame ?? model.defaultFrame,
    params: opts.params ?? ZERO_PARAMS,
    lat: point.lat,
    lon: point.lon,
    alt: opts.alt ?? model.defaultAlt,
    autocontinue: opts.autocontinue ?? true,
  };
}

/** Append a NAV waypoint at `point` (the common map-click / table "add" path). */
export function addWaypoint(
  model: MissionModel,
  point: LatLon,
  opts: WaypointOptions = {},
): MissionModel {
  return { ...model, items: [...model.items, makeWaypoint(model, point, opts)] };
}

/** Insert `item` at index `at` (clamped into `[0, length]`). */
export function insertItem(model: MissionModel, at: number, item: MissionItemModel): MissionModel {
  const index = clampInsert(at, model.items.length);
  const items = [...model.items.slice(0, index), item, ...model.items.slice(index)];
  // Keep the active pointer on the same logical item when we insert before it.
  const currentSeq = index <= model.currentSeq ? model.currentSeq + 1 : model.currentSeq;
  return { ...model, items, currentSeq };
}

/** Delete the item at `index` (no-op when out of range). */
export function deleteItem(model: MissionModel, index: number): MissionModel {
  if (index < 0 || index >= model.items.length) return model;
  const items = [...model.items.slice(0, index), ...model.items.slice(index + 1)];
  let currentSeq = model.currentSeq;
  if (index < currentSeq) currentSeq -= 1;
  const clamped = clampItem(currentSeq, items.length);
  return { ...model, items, currentSeq: clamped === -1 ? 0 : clamped };
}

/** Move the item at `from` to index `to` (both clamped; no-op when equal). */
export function reorder(model: MissionModel, from: number, to: number): MissionModel {
  const length = model.items.length;
  const src = clampItem(from, length);
  if (src === -1) return model;
  const dst = clampItem(to, length);
  if (src === dst) return model;
  const next = [...model.items];
  const [moved] = next.splice(src, 1);
  if (!moved) return model;
  next.splice(dst, 0, moved);
  // Track the active item across the move.
  let currentSeq = model.currentSeq;
  if (model.currentSeq === src) currentSeq = dst;
  else if (src < model.currentSeq && dst >= model.currentSeq) currentSeq -= 1;
  else if (src > model.currentSeq && dst <= model.currentSeq) currentSeq += 1;
  return { ...model, items: next, currentSeq };
}

/** Replace fields of the item at `index` with `patch` (no-op when out of range). */
export function setItem(
  model: MissionModel,
  index: number,
  patch: Partial<MissionItemModel>,
): MissionModel {
  if (index < 0 || index >= model.items.length) return model;
  const items = model.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
  return { ...model, items };
}

/** Set the default altitude (metres) applied to subsequently added waypoints. */
export function setDefaultAlt(model: MissionModel, alt: number): MissionModel {
  return { ...model, defaultAlt: alt };
}

/** Set the default `MAV_FRAME` applied to subsequently added waypoints. */
export function setDefaultFrame(model: MissionModel, frame: number): MissionModel {
  return { ...model, defaultFrame: frame };
}

/** Set the active/current item index (clamped into range). */
export function setCurrent(model: MissionModel, index: number): MissionModel {
  const clamped = clampItem(index, model.items.length);
  return { ...model, currentSeq: clamped === -1 ? 0 : clamped };
}

/** Mean Earth radius (IUGG), metres — matches `geo`/map great-circle helpers. */
export const EARTH_RADIUS_M = 6371008.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle (haversine) distance between two coordinates, in metres.
 * Self-contained so the model has no UI-widget dependency.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Options for {@link estimateMission}. */
export interface EstimateOptions {
  /** Cruise speed (m/s) for the time estimate. Default {@link DEFAULT_CRUISE_MPS}. */
  cruiseSpeedMps?: number;
}

/** True when an item carries a usable geographic position for the path. */
function isPathPoint(item: MissionItemModel): boolean {
  if (!commandHasPosition(item.command)) return false;
  if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return false;
  // Treat the all-zero null-island position as "no fix yet" so it does not
  // inflate the distance estimate before the waypoint is placed.
  return item.lat !== 0 || item.lon !== 0;
}

/**
 * Compute rough mission estimates: total great-circle ground distance over the
 * ordered position waypoints, a time estimate (distance ÷ cruise speed), and
 * the count of position waypoints. Non-position commands (`DO_*`, `CONDITION_*`,
 * RTL, …) are skipped for distance but the path is otherwise sequential.
 */
export function estimateMission(model: MissionModel, opts: EstimateOptions = {}): MissionEstimate {
  const points: LatLon[] = [];
  for (const item of model.items) {
    if (isPathPoint(item)) points.push({ lat: item.lat, lon: item.lon });
  }
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev && cur) distanceM += haversineMeters(prev, cur);
  }
  const cruise = opts.cruiseSpeedMps ?? DEFAULT_CRUISE_MPS;
  const timeS = cruise > 0 ? distanceM / cruise : 0;
  return { distanceM, timeS, waypointCount: points.length };
}
