/**
 * Pure face-sequence and status derivation for the Accelerometer setup step
 * (task T5.4; spec plan/04 §4.4 accel). No Solid, no DOM — these helpers map
 * the six ArduPilot accel poses and the local UI flows onto wizard state.
 */
import type { SettledStatus } from '../framework';

/** Stable ids for ArduPilot's 6-point accelerometer calibration poses. */
export type AccelFaceId = 'LEVEL' | 'LEFT' | 'RIGHT' | 'NOSEDOWN' | 'NOSEUP' | 'BACK';

/** Display metadata for one accelerometer calibration pose. */
export interface AccelFaceDefinition {
  /** Face id as surfaced by `CalibrationClient.accel6Point(step)`. */
  readonly id: AccelFaceId;
  /** i18n key for the short pose label. */
  readonly labelKey: string;
  /** i18n key for the pose instruction. */
  readonly instructionKey: string;
  /** Simple text graphic used in the guide card. */
  readonly graphic: string;
}

const LEVEL_FACE: AccelFaceDefinition = {
  id: 'LEVEL',
  labelKey: 'setup.accel.face.level.label',
  instructionKey: 'setup.accel.face.level.instruction',
  graphic: '▔▔▔\n▔▔▔',
};
const LEFT_FACE: AccelFaceDefinition = {
  id: 'LEFT',
  labelKey: 'setup.accel.face.left.label',
  instructionKey: 'setup.accel.face.left.instruction',
  graphic: '◀\n█',
};
const RIGHT_FACE: AccelFaceDefinition = {
  id: 'RIGHT',
  labelKey: 'setup.accel.face.right.label',
  instructionKey: 'setup.accel.face.right.instruction',
  graphic: '▶\n█',
};
const NOSEDOWN_FACE: AccelFaceDefinition = {
  id: 'NOSEDOWN',
  labelKey: 'setup.accel.face.nosedown.label',
  instructionKey: 'setup.accel.face.nosedown.instruction',
  graphic: '↓\n✈',
};
const NOSEUP_FACE: AccelFaceDefinition = {
  id: 'NOSEUP',
  labelKey: 'setup.accel.face.noseup.label',
  instructionKey: 'setup.accel.face.noseup.instruction',
  graphic: '↑\n✈',
};
const BACK_FACE: AccelFaceDefinition = {
  id: 'BACK',
  labelKey: 'setup.accel.face.back.label',
  instructionKey: 'setup.accel.face.back.instruction',
  graphic: '▁▁▁\n⟲',
};

/** The required ArduPilot 6-point accelerometer pose order. */
export const ACCEL_FACE_SEQUENCE: readonly AccelFaceDefinition[] = [
  LEVEL_FACE,
  LEFT_FACE,
  RIGHT_FACE,
  NOSEDOWN_FACE,
  NOSEUP_FACE,
  BACK_FACE,
] as const;

/** Local flow state for the full 6-point calibration. */
export type AccelFlowState = 'idle' | 'running' | 'done' | 'warning';

/** Local flow state for the separate level calibration action. */
export type LevelFlowState = 'idle' | 'running' | 'done' | 'warning';

/** One-based progress through the six required poses. */
export interface AccelFaceProgress {
  /** Current pose number (`1..6`). */
  readonly current: number;
  /** Total pose count (`6`). */
  readonly total: number;
}

const FACE_BY_ID: Readonly<Record<AccelFaceId, AccelFaceDefinition>> = {
  LEVEL: LEVEL_FACE,
  LEFT: LEFT_FACE,
  RIGHT: RIGHT_FACE,
  NOSEDOWN: NOSEDOWN_FACE,
  NOSEUP: NOSEUP_FACE,
  BACK: BACK_FACE,
};

const NORMALIZED_FACE_IDS: Readonly<Record<string, AccelFaceId>> = {
  LEVEL: 'LEVEL',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  NOSEDOWN: 'NOSEDOWN',
  NOSEUP: 'NOSEUP',
  BACK: 'BACK',
};

/** Normalize a face string from the calibration client into a known face id. */
export function normalizeAccelFace(face: string): AccelFaceId | undefined {
  const key = face.trim().toUpperCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '');
  return NORMALIZED_FACE_IDS[key];
}

/** Return the metadata for a face id. */
export function accelFaceDefinition(id: AccelFaceId): AccelFaceDefinition {
  return FACE_BY_ID[id];
}

/** Derive one-based `face N of 6` progress for a known face id. */
export function accelFaceProgress(id: AccelFaceId): AccelFaceProgress {
  const index = ACCEL_FACE_SEQUENCE.findIndex((face) => face.id === id);
  return { current: index + 1, total: ACCEL_FACE_SEQUENCE.length };
}

/** The i18n key describing a 6-point accel flow state for the live region. */
export function accelFlowStatusKey(flow: AccelFlowState): string {
  return `setup.accel.state.${flow}`;
}

/** The i18n key describing the separate level-calibration state. */
export function levelFlowStatusKey(flow: LevelFlowState): string {
  return `setup.accel.level.state.${flow}`;
}

/**
 * Map accel/level flows onto the setup wizard's settled status. Running maps to
 * `todo`; when this step is selected the framework displays that as `active`.
 */
export function flowsToSettledStatus(
  accel: AccelFlowState,
  level: LevelFlowState = 'idle',
): SettledStatus {
  if (accel === 'warning' || level === 'warning') return 'warning';
  if (accel === 'running' || level === 'running') return 'todo';
  if (accel === 'done') return 'done';
  return 'todo';
}
