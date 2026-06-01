/**
 * Altitude-frame handling for the mission model (task T4.2; spec plan/04 §4.3
 * "altitude frame (relative/AMSL/terrain)"). Pure, dependency-free.
 *
 * The model carries the raw `MAV_FRAME` number on each item; these helpers map
 * it to/from the semantic {@link AltFrame} that editors expose. The default for
 * a new waypoint is `GLOBAL_RELATIVE_ALT_INT` (altitude above home), which is
 * what almost every ArduPilot/PX4 mission uses.
 */
import type { AltFrame } from './types';

/** `MAV_FRAME_GLOBAL_INT` — altitude is AMSL, position as scaled ints. */
export const MAV_FRAME_GLOBAL_INT = 5;
/**
 * `MAV_FRAME_GLOBAL_RELATIVE_ALT_INT` — altitude relative to home, position as
 * scaled ints. The default frame for new waypoints.
 */
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
/** `MAV_FRAME_GLOBAL_TERRAIN_ALT` — altitude above terrain. */
export const MAV_FRAME_GLOBAL_TERRAIN_ALT = 10;

/** The default `MAV_FRAME` applied to newly created waypoints. */
export const DEFAULT_MISSION_FRAME = MAV_FRAME_GLOBAL_RELATIVE_ALT_INT;

/** All semantic altitude frames, in display order. */
export const ALT_FRAMES: readonly AltFrame[] = ['relative', 'amsl', 'terrain'];

/**
 * Map a semantic {@link AltFrame} to its `MAV_FRAME` value (the `*_INT` variant
 * for global frames, matching `MISSION_ITEM_INT`).
 */
export function altFrameToMavFrame(frame: AltFrame): number {
  switch (frame) {
    case 'amsl':
      return MAV_FRAME_GLOBAL_INT;
    case 'terrain':
      return MAV_FRAME_GLOBAL_TERRAIN_ALT;
    case 'relative':
      return MAV_FRAME_GLOBAL_RELATIVE_ALT_INT;
    default: {
      // Exhaustiveness guard (noUncheckedIndexedAccess / strict unions).
      const _exhaustive: never = frame;
      return _exhaustive;
    }
  }
}

/**
 * Map a `MAV_FRAME` value to a semantic {@link AltFrame}. The terrain frame has
 * both an `INT` (11) and non-`INT` (10) form in the dialect; both map to
 * `terrain`. Anything that is not a recognised global AMSL/terrain frame is
 * treated as `relative` (the model's default), so unknown frames degrade
 * gracefully rather than throwing.
 */
export function mavFrameToAltFrame(frame: number): AltFrame {
  switch (frame) {
    case MAV_FRAME_GLOBAL_INT:
    case 0: // MAV_FRAME_GLOBAL (non-INT AMSL)
      return 'amsl';
    case MAV_FRAME_GLOBAL_TERRAIN_ALT:
    case 11: // MAV_FRAME_GLOBAL_TERRAIN_ALT_INT
      return 'terrain';
    default:
      return 'relative';
  }
}
