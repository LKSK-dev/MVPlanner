/**
 * Pure failsafe parameter model for the setup step (T5.8).
 *
 * The list is intentionally Copter-centric ArduPilot failsafe coverage and is
 * guarded by runtime parameter presence: callers pass a lookup backed by
 * {@link ParamClient.get}, and absent names are omitted from the derived UI.
 */
import type { Param, ParamMeta } from '../../../../contracts';
import type { SettledStatus } from '../framework';

/** Failsafe setup section identifiers. */
export type FailsafeSectionId = 'rc' | 'battery' | 'gcs' | 'ekfGps';

/** Supported failsafe setup control kinds. */
export type FailsafeFieldKind = 'enum' | 'number';

/** A numeric enum option shown in an action dropdown. */
export interface FailsafeOption {
  /** Parameter value written when selected. */
  readonly value: number;
  /** Human-readable action label. */
  readonly label: string;
}

/** Static definition for one supported failsafe parameter. */
export interface FailsafeFieldDef {
  /** ArduPilot parameter name. */
  readonly name: FailsafeParamName;
  /** Owning UI section. */
  readonly section: FailsafeSectionId;
  /** Whether this parameter is edited as an enum dropdown or numeric input. */
  readonly kind: FailsafeFieldKind;
  /** i18n label key. */
  readonly labelKey: string;
  /** Curated fallback description. */
  readonly description: string;
  /** Curated fallback units, when known. */
  readonly units?: string | undefined;
  /** Curated fallback lower bound, when useful for inputs. */
  readonly min?: number | undefined;
  /** Curated fallback upper bound, when useful for inputs. */
  readonly max?: number | undefined;
  /** Curated fallback input step. */
  readonly increment?: number | undefined;
  /** Dropdown options for enum/action parameters. */
  readonly options?: readonly FailsafeOption[] | undefined;
}

/** Derived UI field for a present failsafe parameter. */
export interface FailsafeField extends Omit<FailsafeFieldDef, 'description' | 'units'> {
  /** Current parameter value from {@link ParamClient.get}. */
  readonly value: number;
  /** Description after merging curated/available metadata. */
  readonly description: string;
  /** Units after merging curated/available metadata. */
  readonly units?: string | undefined;
}

/** Derived UI section containing only present parameters. */
export interface FailsafeSection {
  /** Section id. */
  readonly id: FailsafeSectionId;
  /** i18n section title key. */
  readonly titleKey: string;
  /** Present fields in display order. */
  readonly fields: readonly FailsafeField[];
}

/** Minimal metadata resolver seam compatible with `mavlink/param-meta`. */
export interface FailsafeMetaResolver {
  /** Return metadata for `name`, or undefined if unavailable. */
  get(name: string): ParamMeta | undefined;
}

const RC_FAILSAFE_OPTIONS: readonly FailsafeOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Enabled always RTL' },
  { value: 2, label: 'Enabled Continue in Auto' },
  { value: 3, label: 'Enabled always Land' },
];

const BATTERY_FAILSAFE_OPTIONS: readonly FailsafeOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Land' },
  { value: 2, label: 'RTL' },
  { value: 3, label: 'SmartRTL or RTL' },
  { value: 4, label: 'SmartRTL or Land' },
  { value: 5, label: 'Terminate' },
];

const GCS_FAILSAFE_OPTIONS: readonly FailsafeOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Enabled always RTL' },
  { value: 2, label: 'Enabled Continue in Auto' },
  { value: 5, label: 'Enabled always SmartRTL or RTL' },
  { value: 6, label: 'Enabled always SmartRTL or Land' },
  { value: 7, label: 'Enabled always Land' },
];

const EKF_FAILSAFE_OPTIONS: readonly FailsafeOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Land' },
  { value: 2, label: 'AltHold' },
  { value: 3, label: 'Land even in Stabilize' },
];

/** Supported ArduPilot failsafe parameter names, in UI order. */
export const FAILSAFE_PARAM_NAMES = [
  'FS_THR_ENABLE',
  'FS_THR_VALUE',
  'BATT_LOW_VOLT',
  'BATT_LOW_MAH',
  'BATT_FS_LOW_ACT',
  'BATT_CRT_VOLT',
  'BATT_FS_CRT_ACT',
  'FS_GCS_ENABLE',
  'FS_EKF_ACTION',
  'FS_EKF_THRESH',
] as const;

/** Union of supported failsafe parameter names. */
export type FailsafeParamName = (typeof FAILSAFE_PARAM_NAMES)[number];

/** Static section order and titles. */
export const FAILSAFE_SECTIONS: readonly { id: FailsafeSectionId; titleKey: string }[] = [
  { id: 'rc', titleKey: 'setup.failsafe.section.rc' },
  { id: 'battery', titleKey: 'setup.failsafe.section.battery' },
  { id: 'gcs', titleKey: 'setup.failsafe.section.gcs' },
  { id: 'ekfGps', titleKey: 'setup.failsafe.section.ekfGps' },
];

/** Static failsafe field definitions with curated fallback metadata. */
export const FAILSAFE_FIELD_DEFS: readonly FailsafeFieldDef[] = [
  {
    name: 'FS_THR_ENABLE',
    section: 'rc',
    kind: 'enum',
    labelKey: 'setup.failsafe.field.FS_THR_ENABLE',
    description: 'Throttle/RC failsafe enable and action.',
    options: RC_FAILSAFE_OPTIONS,
  },
  {
    name: 'FS_THR_VALUE',
    section: 'rc',
    kind: 'number',
    labelKey: 'setup.failsafe.field.FS_THR_VALUE',
    description: 'PWM threshold below which RC throttle failsafe triggers.',
    units: 'PWM',
    min: 800,
    max: 1200,
    increment: 1,
  },
  {
    name: 'BATT_LOW_VOLT',
    section: 'battery',
    kind: 'number',
    labelKey: 'setup.failsafe.field.BATT_LOW_VOLT',
    description: 'Battery voltage threshold for low battery failsafe; 0 disables the threshold.',
    units: 'V',
    min: 0,
    increment: 0.1,
  },
  {
    name: 'BATT_LOW_MAH',
    section: 'battery',
    kind: 'number',
    labelKey: 'setup.failsafe.field.BATT_LOW_MAH',
    description: 'Remaining capacity threshold for low battery failsafe; 0 disables the threshold.',
    units: 'mAh',
    min: 0,
    increment: 50,
  },
  {
    name: 'BATT_FS_LOW_ACT',
    section: 'battery',
    kind: 'enum',
    labelKey: 'setup.failsafe.field.BATT_FS_LOW_ACT',
    description: 'Action taken when the low battery failsafe triggers.',
    options: BATTERY_FAILSAFE_OPTIONS,
  },
  {
    name: 'BATT_CRT_VOLT',
    section: 'battery',
    kind: 'number',
    labelKey: 'setup.failsafe.field.BATT_CRT_VOLT',
    description:
      'Battery voltage threshold for critical battery failsafe; 0 disables the threshold.',
    units: 'V',
    min: 0,
    increment: 0.1,
  },
  {
    name: 'BATT_FS_CRT_ACT',
    section: 'battery',
    kind: 'enum',
    labelKey: 'setup.failsafe.field.BATT_FS_CRT_ACT',
    description: 'Action taken when the critical battery failsafe triggers.',
    options: BATTERY_FAILSAFE_OPTIONS,
  },
  {
    name: 'FS_GCS_ENABLE',
    section: 'gcs',
    kind: 'enum',
    labelKey: 'setup.failsafe.field.FS_GCS_ENABLE',
    description: 'Ground-control-station link-loss failsafe enable and action.',
    options: GCS_FAILSAFE_OPTIONS,
  },
  {
    name: 'FS_EKF_ACTION',
    section: 'ekfGps',
    kind: 'enum',
    labelKey: 'setup.failsafe.field.FS_EKF_ACTION',
    description: 'Action taken when EKF/GPS variance exceeds the failsafe threshold.',
    options: EKF_FAILSAFE_OPTIONS,
  },
  {
    name: 'FS_EKF_THRESH',
    section: 'ekfGps',
    kind: 'number',
    labelKey: 'setup.failsafe.field.FS_EKF_THRESH',
    description: 'EKF/GPS variance threshold that triggers the failsafe.',
    min: 0,
    increment: 0.1,
  },
];

const PARAM_NAME_SET = new Set<string>(FAILSAFE_PARAM_NAMES);

/** Return true when `name` is one of the failsafe setup parameters. */
export function isFailsafeParamName(name: string): name is FailsafeParamName {
  return PARAM_NAME_SET.has(name);
}

function metaDescription(
  def: FailsafeFieldDef,
  param: Param,
  resolver: FailsafeMetaResolver | undefined,
): string {
  return param.meta?.description ?? resolver?.get(def.name)?.description ?? def.description;
}

function metaUnits(
  def: FailsafeFieldDef,
  param: Param,
  resolver: FailsafeMetaResolver | undefined,
): string | undefined {
  return param.meta?.units ?? resolver?.get(def.name)?.units ?? def.units;
}

function metaMin(
  def: FailsafeFieldDef,
  param: Param,
  resolver: FailsafeMetaResolver | undefined,
): number | undefined {
  return param.meta?.min ?? resolver?.get(def.name)?.min ?? def.min;
}

function metaMax(
  def: FailsafeFieldDef,
  param: Param,
  resolver: FailsafeMetaResolver | undefined,
): number | undefined {
  return param.meta?.max ?? resolver?.get(def.name)?.max ?? def.max;
}

function metaIncrement(
  def: FailsafeFieldDef,
  param: Param,
  resolver: FailsafeMetaResolver | undefined,
): number | undefined {
  return param.meta?.increment ?? resolver?.get(def.name)?.increment ?? def.increment;
}

/**
 * Derive visible failsafe sections from the current parameter cache.
 *
 * Parameters that are not returned by `readParam` are treated as absent for the
 * connected firmware and are skipped gracefully.
 */
export function deriveFailsafeSections(
  readParam: (name: FailsafeParamName) => Param | undefined,
  resolver?: FailsafeMetaResolver,
): readonly FailsafeSection[] {
  const fields: FailsafeField[] = [];
  for (const def of FAILSAFE_FIELD_DEFS) {
    const param = readParam(def.name);
    if (param === undefined) continue;
    fields.push({
      ...def,
      value: param.value,
      description: metaDescription(def, param, resolver),
      ...(metaUnits(def, param, resolver) !== undefined
        ? { units: metaUnits(def, param, resolver) }
        : {}),
      ...(metaMin(def, param, resolver) !== undefined
        ? { min: metaMin(def, param, resolver) }
        : {}),
      ...(metaMax(def, param, resolver) !== undefined
        ? { max: metaMax(def, param, resolver) }
        : {}),
      ...(metaIncrement(def, param, resolver) !== undefined
        ? { increment: metaIncrement(def, param, resolver) }
        : {}),
    });
  }

  const sections: FailsafeSection[] = [];
  for (const section of FAILSAFE_SECTIONS) {
    const sectionFields = fields.filter((field) => field.section === section.id);
    if (sectionFields.length === 0) continue;
    sections.push({ ...section, fields: sectionFields });
  }
  return sections;
}

/** Derive the setup-step status from visible/present failsafe parameters. */
export function deriveFailsafeStatus(sections: readonly FailsafeSection[]): SettledStatus {
  return sections.some((section) => section.fields.length > 0) ? 'done' : 'todo';
}
