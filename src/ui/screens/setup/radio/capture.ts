/**
 * Pure RC radio-calibration capture helpers (T5.6; spec plan/04 §4.4 radio).
 *
 * The UI streams raw RC channel arrays through {@link accumulateRadioChannels}.
 * For each one-based channel it keeps the latest value, captured min/max, and
 * the latest resting-center value used as `RCn_TRIM` when the operator presses
 * Save after returning sticks/switches to their neutral position.
 */

/** One captured RC channel, identified by MAVLink/ArduPilot's one-based index. */
export interface RadioChannelCapture {
  /** One-based RC channel number (`1` writes `RC1_*`). */
  readonly index: number;
  /** Latest raw PWM value seen for this channel. */
  readonly current: number;
  /** Lowest raw PWM value seen since capture started. */
  readonly min: number;
  /** Highest raw PWM value seen since capture started. */
  readonly max: number;
  /** Latest raw PWM value, saved as the resting-center trim. */
  readonly trim: number;
  /** Number of samples accepted for this channel. */
  readonly sampleCount: number;
}

/** Immutable capture state for all active channels. */
export interface RadioCaptureState {
  /** Active channels seen so far, sorted by one-based channel index. */
  readonly channels: readonly RadioChannelCapture[];
}

/** A pending parameter write derived from a completed radio capture. */
export interface RadioParamWrite {
  /** Parameter name, e.g. `RC1_MIN`. */
  readonly name: string;
  /** Rounded PWM value to write. */
  readonly value: number;
}

/** Empty capture state used when starting/restarting calibration. */
export const EMPTY_RADIO_CAPTURE: RadioCaptureState = { channels: [] };

/** Lowest/Highest expected RC PWM endpoints used for display scaling only. */
export const RADIO_PWM_DISPLAY_MIN = 800;
export const RADIO_PWM_DISPLAY_MAX = 2200;

/** Return a finite integer PWM value, or `undefined` for invalid samples. */
function normalizePwm(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value);
}

/** Clamp a value into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Percentage position for an RC bar rendered over the display PWM range. */
export function radioBarPercent(value: number): number {
  const span = RADIO_PWM_DISPLAY_MAX - RADIO_PWM_DISPLAY_MIN;
  return clamp(((value - RADIO_PWM_DISPLAY_MIN) / span) * 100, 0, 100);
}

/**
 * Accumulate one streamed RC channel array into `previous`.
 *
 * Channels are one-based in the returned state. A channel becomes active the
 * first time a valid sample appears and remains active even if a later MAVLink
 * sample array is shorter; its `trim`/`current` then stay at their latest value.
 */
export function accumulateRadioChannels(
  previous: RadioCaptureState,
  rawChannels: readonly number[],
): RadioCaptureState {
  const byIndex = new Map<number, RadioChannelCapture>();
  for (const channel of previous.channels) byIndex.set(channel.index, channel);

  for (let i = 0; i < rawChannels.length; i++) {
    const value = normalizePwm(rawChannels[i] ?? Number.NaN);
    if (value === undefined) continue;

    const index = i + 1;
    const existing = byIndex.get(index);
    const next: RadioChannelCapture =
      existing === undefined
        ? { index, current: value, min: value, max: value, trim: value, sampleCount: 1 }
        : {
            index,
            current: value,
            min: Math.min(existing.min, value),
            max: Math.max(existing.max, value),
            trim: value,
            sampleCount: existing.sampleCount + 1,
          };
    byIndex.set(index, next);
  }

  return { channels: [...byIndex.values()].sort((a, b) => a.index - b.index) };
}

/** Build the `RCn_MIN/MAX/TRIM` writes for every active channel. */
export function radioParamWrites(
  channels: readonly RadioChannelCapture[],
): readonly RadioParamWrite[] {
  const writes: RadioParamWrite[] = [];
  for (const channel of channels) {
    writes.push({ name: `RC${channel.index}_MIN`, value: Math.round(channel.min) });
    writes.push({ name: `RC${channel.index}_MAX`, value: Math.round(channel.max) });
    writes.push({ name: `RC${channel.index}_TRIM`, value: Math.round(channel.trim) });
  }
  return writes;
}
