/**
 * Mapping between the editing {@link MissionModel} and the FROZEN wire
 * {@link Mission} / {@link MissionItem} contracts (task T4.2; spec plan/04 §4.3).
 * Pure, dependency-free.
 *
 * The wire item stores geographic position as `MISSION_ITEM_INT`-style scaled
 * integers (`x`/`y` = degrees × 1e7); the model stores plain degrees. These
 * helpers are the single place that applies the 1e7 scale, so editors never do.
 */
import type { Mission, MissionItem } from '../../contracts';
import { DEFAULT_MISSION_FRAME } from './frames';
import type { MissionItemModel, MissionModel, MissionType } from './types';

/** Degrees ↔ `MISSION_ITEM_INT` `x`/`y` scale factor (1e7). */
export const LATLON_SCALE = 1e7;

/** Default altitude (metres) used when none is supplied to {@link createMission}. */
export const DEFAULT_ALT_M = 50;

/** Degrees → scaled `MISSION_ITEM_INT` integer. */
export function degToScaled(deg: number): number {
  return Math.round(deg * LATLON_SCALE);
}

/** Scaled `MISSION_ITEM_INT` integer → degrees. */
export function scaledToDeg(scaled: number): number {
  return scaled / LATLON_SCALE;
}

/** Convert one wire {@link MissionItem} to a {@link MissionItemModel}. */
export function itemFromWire(item: MissionItem): MissionItemModel {
  return {
    command: item.command,
    frame: item.frame,
    params: [item.params[0], item.params[1], item.params[2], item.params[3]],
    lat: scaledToDeg(item.x),
    lon: scaledToDeg(item.y),
    alt: item.z,
    autocontinue: item.autocontinue !== 0,
  };
}

/**
 * Convert one {@link MissionItemModel} to a wire {@link MissionItem}.
 *
 * @param seq - The item's `seq` (its index in the list).
 * @param current - Whether this is the active item (`current = 1`).
 */
export function itemToWire(item: MissionItemModel, seq: number, current: boolean): MissionItem {
  return {
    seq,
    frame: item.frame,
    command: item.command,
    current: current ? 1 : 0,
    autocontinue: item.autocontinue ? 1 : 0,
    params: [item.params[0], item.params[1], item.params[2], item.params[3]],
    x: degToScaled(item.lat),
    y: degToScaled(item.lon),
    z: item.alt,
  };
}

/**
 * Build a {@link MissionModel} from a wire {@link Mission}. The model's defaults
 * are seeded from the first item (its frame) and the supplied/first altitude;
 * `currentSeq` tracks the first item flagged `current`.
 */
export function missionFromWire(mission: Mission): MissionModel {
  const items = mission.items.map(itemFromWire);
  const currentIndex = mission.items.findIndex((i) => i.current !== 0);
  const first = items[0];
  return {
    type: mission.type,
    items,
    defaultAlt: first ? first.alt : DEFAULT_ALT_M,
    defaultFrame: first ? first.frame : DEFAULT_MISSION_FRAME,
    currentSeq: currentIndex >= 0 ? currentIndex : 0,
  };
}

/**
 * Serialise a {@link MissionModel} to a wire {@link Mission}. Item `seq` is the
 * array index; `current = 1` is set on the item at {@link MissionModel.currentSeq}
 * (clamped into range).
 */
export function missionToWire(model: MissionModel): Mission {
  const currentSeq =
    model.items.length === 0 ? -1 : clampIndex(model.currentSeq, model.items.length);
  return {
    type: model.type,
    items: model.items.map((item, seq) => itemToWire(item, seq, seq === currentSeq)),
  };
}

function clampIndex(index: number, length: number): number {
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/** A bare, valid empty mission of `type` for round-trip / reset paths. */
export function emptyWireMission(type: MissionType): Mission {
  return { type, items: [] };
}
