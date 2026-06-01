/** Public types for the DataFlash log query engine. */

/** A selectable numeric DataFlash message field. */
export interface LogSeriesDescriptor {
  /** DataFlash message name, for example `ATT` or `GPS`. */
  readonly message: string;
  /** Numeric field name within the message. */
  readonly field: string;
  /** Optional unit label or unit id when FMTU/UNIT metadata is available. */
  readonly unit?: string;
}

/** Inclusive microsecond time window for a query. */
export interface LogQueryRange {
  /** First timestamp to include, in ArduPilot microseconds. */
  readonly fromUs?: number;
  /** Last timestamp to include, in ArduPilot microseconds. */
  readonly toUs?: number;
}

/** One full-resolution or downsampled point returned to the plotter. */
export interface LogQueryPoint {
  /** Timestamp in microseconds. For buckets this is the bucket midpoint. */
  readonly t: number;
  /** Minimum value in the bucket. Equal to `value` for full-resolution points. */
  readonly min: number;
  /** Maximum value in the bucket. Equal to `value` for full-resolution points. */
  readonly max: number;
  /** First value in the bucket. */
  readonly first: number;
  /** Last value in the bucket. */
  readonly last: number;
  /** Arithmetic mean of finite values in the bucket. */
  readonly mean: number;
  /** Number of raw samples represented by this point. */
  readonly count: number;
  /** Present for full-resolution points. */
  readonly value?: number;
}

/** Columnar storage for one indexed numeric series. */
export interface LogSeriesData {
  /** Monotonically sorted timestamps in microseconds. */
  readonly timesUs: Float64Array;
  /** Numeric field values aligned one-to-one with `timesUs`. */
  readonly values: Float64Array;
}
