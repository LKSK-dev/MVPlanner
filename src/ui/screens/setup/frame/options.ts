/**
 * Pure frame/class option tables and selection derivation for the setup frame
 * step (T5.3; spec plan/04 §4.4). This file deliberately contains no Solid UI
 * and no MAVLink side effects, so it is straightforward to unit-test against a
 * mocked parameter snapshot.
 */
import type { VehicleClass } from '../../../../contracts';

/** Parameter names the frame setup step understands. */
export const FRAME_PARAM_NAMES = [
  'FRAME_CLASS',
  'FRAME_TYPE',
  'Q_FRAME_CLASS',
  'Q_FRAME_TYPE',
  'FRAME_CONFIG',
] as const;

/** A frame-related ArduPilot parameter name. */
export type FrameParamName = (typeof FRAME_PARAM_NAMES)[number];

/** Semantic role a parameter plays in frame setup. */
export type FrameParamRole = 'class' | 'type' | 'config';

/** Rendering mode for the detected vehicle class. */
export type FrameSelectionMode = 'selectable' | 'parameters' | 'unsupported';

/** One selectable numeric value for a frame parameter. */
export interface FrameOption {
  /** Numeric value written to the parameter. */
  readonly value: number;
  /** i18n label key under `setup.frame.*`. */
  readonly labelKey: string;
}

/** Definition of a frame-related parameter for one vehicle class. */
export interface FrameParamDefinition {
  /** Parameter name on the vehicle. */
  readonly name: FrameParamName;
  /** Semantic role for status derivation and copy. */
  readonly role: FrameParamRole;
  /** i18n label key for the parameter. */
  readonly labelKey: string;
  /** Known safe options. Empty means display the current value only. */
  readonly options: readonly FrameOption[];
}

/** Derived current value for one frame parameter. */
export interface FrameParamSelection extends FrameParamDefinition {
  /** Current numeric value, if present in the parameter cache. */
  readonly value: number | undefined;
  /** Matched known option for `value`, when this parameter has an option table. */
  readonly option: FrameOption | undefined;
}

/** Vehicle-aware frame selection derived from current parameters. */
export interface FrameSelection {
  /** Current vehicle class used to choose parameter definitions. */
  readonly vehicleClass: VehicleClass;
  /** Whether the UI can safely offer selectors or should only point at params. */
  readonly mode: FrameSelectionMode;
  /** Parameters relevant to this vehicle class. */
  readonly params: readonly FrameParamSelection[];
  /** The class-like parameter, when one is relevant. */
  readonly frameClass: FrameParamSelection | undefined;
  /** The type-like parameter, when one is relevant. */
  readonly frameType: FrameParamSelection | undefined;
  /** True when a frame class parameter is present and valid for its table. */
  readonly validFrameClass: boolean;
}

/** Copter `FRAME_CLASS` values supported by ArduPilot. */
export const COPTER_FRAME_CLASS_OPTIONS: readonly FrameOption[] = [
  { value: 1, labelKey: 'setup.frame.copter.class.quad' },
  { value: 2, labelKey: 'setup.frame.copter.class.hexa' },
  { value: 3, labelKey: 'setup.frame.copter.class.octo' },
  { value: 4, labelKey: 'setup.frame.copter.class.octoQuad' },
  { value: 5, labelKey: 'setup.frame.copter.class.y6' },
  { value: 7, labelKey: 'setup.frame.copter.class.tri' },
  { value: 10, labelKey: 'setup.frame.copter.class.single' },
  { value: 11, labelKey: 'setup.frame.copter.class.coax' },
  { value: 12, labelKey: 'setup.frame.copter.class.biCopter' },
  { value: 13, labelKey: 'setup.frame.copter.class.heli' },
  { value: 14, labelKey: 'setup.frame.copter.class.heliDual' },
  { value: 15, labelKey: 'setup.frame.copter.class.heliQuad' },
  { value: 16, labelKey: 'setup.frame.copter.class.dodecaHexa' },
  { value: 17, labelKey: 'setup.frame.copter.class.heliQuad17' },
];

/** Copter `FRAME_TYPE` values supported by ArduPilot. */
export const COPTER_FRAME_TYPE_OPTIONS: readonly FrameOption[] = [
  { value: 0, labelKey: 'setup.frame.copter.type.plus' },
  { value: 1, labelKey: 'setup.frame.copter.type.x' },
  { value: 2, labelKey: 'setup.frame.copter.type.v' },
  { value: 3, labelKey: 'setup.frame.copter.type.h' },
  { value: 4, labelKey: 'setup.frame.copter.type.vTail' },
  { value: 5, labelKey: 'setup.frame.copter.type.aTail' },
  { value: 10, labelKey: 'setup.frame.copter.type.y6b' },
  { value: 11, labelKey: 'setup.frame.copter.type.y6f' },
  { value: 12, labelKey: 'setup.frame.copter.type.betaFlightX' },
  { value: 13, labelKey: 'setup.frame.copter.type.djiX' },
  { value: 14, labelKey: 'setup.frame.copter.type.clockwiseX' },
];

/** Parameter set used for one vehicle-class UI mode. */
export interface VehicleFrameDefinition {
  /** Rendering mode for the vehicle class. */
  readonly mode: FrameSelectionMode;
  /** Relevant frame parameters for display/selection. */
  readonly params: readonly FrameParamDefinition[];
}

const COPTER_DEFINITION: VehicleFrameDefinition = {
  mode: 'selectable',
  params: [
    {
      name: 'FRAME_CLASS',
      role: 'class',
      labelKey: 'setup.frame.param.frameClass',
      options: COPTER_FRAME_CLASS_OPTIONS,
    },
    {
      name: 'FRAME_TYPE',
      role: 'type',
      labelKey: 'setup.frame.param.frameType',
      options: COPTER_FRAME_TYPE_OPTIONS,
    },
  ],
};

const PLANE_DEFINITION: VehicleFrameDefinition = {
  mode: 'parameters',
  params: [
    {
      name: 'Q_FRAME_CLASS',
      role: 'class',
      labelKey: 'setup.frame.param.qFrameClass',
      options: [],
    },
    {
      name: 'Q_FRAME_TYPE',
      role: 'type',
      labelKey: 'setup.frame.param.qFrameType',
      options: [],
    },
  ],
};

const ROVER_DEFINITION: VehicleFrameDefinition = {
  mode: 'parameters',
  params: [
    {
      name: 'FRAME_CLASS',
      role: 'class',
      labelKey: 'setup.frame.param.frameClass',
      options: [],
    },
  ],
};

const SUB_DEFINITION: VehicleFrameDefinition = {
  mode: 'parameters',
  params: [
    {
      name: 'FRAME_CONFIG',
      role: 'config',
      labelKey: 'setup.frame.param.frameConfig',
      options: [],
    },
  ],
};

const UNSUPPORTED_DEFINITION: VehicleFrameDefinition = {
  mode: 'unsupported',
  params: [],
};

/** Returns true when `name` is one of the frame parameters observed by this step. */
export function isFrameParamName(name: string): name is FrameParamName {
  return (FRAME_PARAM_NAMES as readonly string[]).includes(name);
}

/** Find a known option by numeric value. */
export function findFrameOption(
  options: readonly FrameOption[],
  value: number | undefined,
): FrameOption | undefined {
  if (value === undefined) return undefined;
  return options.find((option) => option.value === value);
}

/** The frame parameter definition for a detected vehicle class. */
export function definitionForVehicleClass(vehicleClass: VehicleClass): VehicleFrameDefinition {
  switch (vehicleClass) {
    case 'copter':
      return COPTER_DEFINITION;
    case 'plane':
      return PLANE_DEFINITION;
    case 'rover':
    case 'boat':
      return ROVER_DEFINITION;
    case 'sub':
      return SUB_DEFINITION;
    case 'tracker':
    case 'unknown':
      return UNSUPPORTED_DEFINITION;
  }
}

/** Read a numeric parameter value by name from a caller-owned snapshot/cache. */
export type FrameParamValueReader = (name: FrameParamName) => number | undefined;

/**
 * Derive the current frame selection from a vehicle class and a param reader.
 * A frame class is valid when it is present and, if a table is known, matches
 * that table. For parameter-only vehicle classes no option labels are invented:
 * the current numeric values are displayed as-is.
 */
export function deriveFrameSelection(
  vehicleClass: VehicleClass,
  readValue: FrameParamValueReader,
): FrameSelection {
  const definition = definitionForVehicleClass(vehicleClass);
  const params = definition.params.map((param): FrameParamSelection => {
    const raw = readValue(param.name);
    const value = raw !== undefined && Number.isFinite(raw) ? raw : undefined;
    return {
      ...param,
      value,
      option: findFrameOption(param.options, value),
    };
  });
  const frameClass = params.find((param) => param.role === 'class');
  const frameType = params.find((param) => param.role === 'type');
  return {
    vehicleClass,
    mode: definition.mode,
    params,
    frameClass,
    frameType,
    validFrameClass: hasValidFrameClass(frameClass),
  };
}

/** True when a class parameter is present and valid for its option table. */
export function hasValidFrameClass(param: FrameParamSelection | undefined): boolean {
  if (param === undefined || param.value === undefined) return false;
  return param.options.length === 0 || param.option !== undefined;
}
