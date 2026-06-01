/**
 * Preset analyses for tlog/log review (task T6.6; spec plan/04 §4.8).
 *
 * Spec §4.8 lists named preset analyses — vibration, EKF, battery, GPS, and PID
 * setpoint-vs-actual — that pick which message fields to chart. This module owns
 * only the preset DEFINITIONS and the selection-to-field-spec mapping; the chart
 * rendering itself is the plotter's job (T6.4) and the Logs assembly (T6.8)
 * consumes the returned {@link AnalysisFieldSpec}.
 *
 * Field references use MAVLink message + field names (presets drive tlog replay
 * analysis), grouped into series with an `axis` key so the plotter can place
 * related signals on a shared axis (e.g. PID desired vs achieved overlay).
 */

/** A single message-field reference to chart. */
export interface FieldRef {
  /** MAVLink message name, e.g. `'VIBRATION'`. */
  readonly message: string;
  /** Field name within the message, e.g. `'vibration_x'`. */
  readonly field: string;
}

/** A group of fields plotted together on a shared axis. */
export interface PresetSeries {
  /** Stable series id (unique within a preset). */
  readonly id: string;
  /** i18n key for the human-readable series label. */
  readonly labelKey: string;
  /** Logical axis group id; series sharing an `axis` share a plot axis. */
  readonly axis: string;
  /** The message fields charted by this series. */
  readonly fields: readonly FieldRef[];
}

/** A named preset analysis definition. */
export interface AnalysisPreset {
  /** Stable preset id (used as the `<option>` value). */
  readonly id: string;
  /** i18n key for the preset's display label. */
  readonly labelKey: string;
  /** i18n key for the preset's one-line description. */
  readonly descriptionKey: string;
  /** The series this preset charts. */
  readonly series: readonly PresetSeries[];
}

/**
 * The field-selection spec a preset resolves to. The plotter (T6.4) / Logs
 * assembly (T6.8) consume this to add the corresponding series to the chart.
 */
export interface AnalysisFieldSpec {
  /** The id of the preset that produced this spec. */
  readonly presetId: string;
  /** The series (each with its fields + axis group) to chart. */
  readonly series: readonly PresetSeries[];
}

/**
 * The shipped preset analyses (spec plan/04 §4.8). Frozen so callers cannot
 * mutate the shared definitions.
 */
export const ANALYSIS_PRESETS: readonly AnalysisPreset[] = Object.freeze([
  {
    id: 'vibration',
    labelKey: 'logs.playback.preset.vibration',
    descriptionKey: 'logs.playback.preset.vibration.desc',
    series: [
      {
        id: 'vibe.xyz',
        labelKey: 'logs.playback.series.vibe.xyz',
        axis: 'vibe',
        fields: [
          { message: 'VIBRATION', field: 'vibration_x' },
          { message: 'VIBRATION', field: 'vibration_y' },
          { message: 'VIBRATION', field: 'vibration_z' },
        ],
      },
      {
        id: 'vibe.clip',
        labelKey: 'logs.playback.series.vibe.clip',
        axis: 'count',
        fields: [
          { message: 'VIBRATION', field: 'clipping_0' },
          { message: 'VIBRATION', field: 'clipping_1' },
          { message: 'VIBRATION', field: 'clipping_2' },
        ],
      },
    ],
  },
  {
    id: 'ekf',
    labelKey: 'logs.playback.preset.ekf',
    descriptionKey: 'logs.playback.preset.ekf.desc',
    series: [
      {
        id: 'ekf.variances',
        labelKey: 'logs.playback.series.ekf.variances',
        axis: 'variance',
        fields: [
          { message: 'EKF_STATUS_REPORT', field: 'velocity_variance' },
          { message: 'EKF_STATUS_REPORT', field: 'pos_horiz_variance' },
          { message: 'EKF_STATUS_REPORT', field: 'pos_vert_variance' },
          { message: 'EKF_STATUS_REPORT', field: 'compass_variance' },
          { message: 'EKF_STATUS_REPORT', field: 'terrain_alt_variance' },
        ],
      },
    ],
  },
  {
    id: 'battery',
    labelKey: 'logs.playback.preset.battery',
    descriptionKey: 'logs.playback.preset.battery.desc',
    series: [
      {
        id: 'battery.voltage',
        labelKey: 'logs.playback.series.battery.voltage',
        axis: 'mV',
        fields: [{ message: 'SYS_STATUS', field: 'voltage_battery' }],
      },
      {
        id: 'battery.current',
        labelKey: 'logs.playback.series.battery.current',
        axis: 'cA',
        fields: [{ message: 'SYS_STATUS', field: 'current_battery' }],
      },
      {
        id: 'battery.remaining',
        labelKey: 'logs.playback.series.battery.remaining',
        axis: 'pct',
        fields: [{ message: 'SYS_STATUS', field: 'battery_remaining' }],
      },
    ],
  },
  {
    id: 'gps',
    labelKey: 'logs.playback.preset.gps',
    descriptionKey: 'logs.playback.preset.gps.desc',
    series: [
      {
        id: 'gps.sats',
        labelKey: 'logs.playback.series.gps.sats',
        axis: 'count',
        fields: [{ message: 'GPS_RAW_INT', field: 'satellites_visible' }],
      },
      {
        id: 'gps.dop',
        labelKey: 'logs.playback.series.gps.dop',
        axis: 'dop',
        fields: [
          { message: 'GPS_RAW_INT', field: 'eph' },
          { message: 'GPS_RAW_INT', field: 'epv' },
        ],
      },
      {
        id: 'gps.fix',
        labelKey: 'logs.playback.series.gps.fix',
        axis: 'fix',
        fields: [{ message: 'GPS_RAW_INT', field: 'fix_type' }],
      },
    ],
  },
  {
    id: 'pid',
    labelKey: 'logs.playback.preset.pid',
    descriptionKey: 'logs.playback.preset.pid.desc',
    series: [
      {
        id: 'pid.desired',
        labelKey: 'logs.playback.series.pid.desired',
        axis: 'pid',
        fields: [{ message: 'PID_TUNING', field: 'desired' }],
      },
      {
        id: 'pid.achieved',
        labelKey: 'logs.playback.series.pid.achieved',
        axis: 'pid',
        fields: [{ message: 'PID_TUNING', field: 'achieved' }],
      },
    ],
  },
]);

/** Look up a preset definition by id, or `undefined` when none matches. */
export function getPreset(id: string): AnalysisPreset | undefined {
  return ANALYSIS_PRESETS.find((p) => p.id === id);
}

/**
 * Resolve a preset to the {@link AnalysisFieldSpec} the plotter consumes. The
 * spec carries the preset id and its series (fields + axis groups) verbatim.
 */
export function presetFieldSpec(preset: AnalysisPreset): AnalysisFieldSpec {
  return { presetId: preset.id, series: preset.series };
}
