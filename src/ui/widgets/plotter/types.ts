/** Public types for the uPlot-backed log plotter widget (T6.4). */
import type { LogQueryPoint } from '../../../data/log-query';

/** A selected DataFlash log series ready to plot. */
export interface PlotterSeriesInput {
  /** Stable caller-owned id, used for diffing and aria summaries. */
  readonly id: string;
  /** Human readable label, for example `ATT.Roll`. */
  readonly label: string;
  /** Logical y-axis id. Series with the same id share a scale/axis. */
  readonly axisId: string;
  /** Downsampled or full-resolution samples returned by LogQueryIndex. */
  readonly samples: readonly LogQueryPoint[];
  /** Optional CSS color. Defaults to the plotter palette. */
  readonly color?: string;
}

/** Marker category rendered on the timeline. */
export type PlotterMarkerKind = 'event' | 'mode' | 'error';

/** A vertical marker line or a time region overlaid on the plot. */
export interface PlotterMarker {
  /** Stable marker id. */
  readonly id: string;
  /** Marker label for overlays and accessibility. */
  readonly label: string;
  /** Semantic marker kind. */
  readonly kind: PlotterMarkerKind;
  /** Start timestamp in log microseconds. */
  readonly startUs: number;
  /** Optional exclusive-ish end timestamp; when greater than start, renders a region. */
  readonly endUs?: number;
  /** Optional CSS color overriding the default kind color. */
  readonly color?: string;
}

/** A marker after validation/default-color assignment. */
export interface NormalizedPlotterMarker {
  readonly id: string;
  readonly label: string;
  readonly kind: PlotterMarkerKind;
  readonly startUs: number;
  readonly endUs?: number;
  readonly color: string;
}

/** Common-x aligned data before it is passed to uPlot. */
export interface PlotterAlignedSeries {
  /** Sorted unique x timestamps in microseconds. */
  readonly x: readonly number[];
  /** One y-array per input series, aligned to `x`; null means no sample at that x. */
  readonly y: readonly (readonly (number | null)[])[];
}

/** uPlot's aligned tuple shape, with x in microseconds. */
export type PlotterUPlotData = [xValues: number[], ...yValues: (number | null)[][]];

/** Pure transform output consumed by the Solid component. */
export interface PlotterModel {
  /** Common-x aligned arrays for tests/readouts. */
  readonly aligned: PlotterAlignedSeries;
  /** uPlot aligned data tuple. */
  readonly data: PlotterUPlotData;
  /** Stable signature of series/axis layout (not sample values). */
  readonly structureKey: string;
}

/** Plotter component props. */
export interface PlotterProps {
  /** Series selected by the Logs screen/query layer. */
  readonly series: readonly PlotterSeriesInput[];
  /** Optional event/mode/error markers overlaid as vertical lines or regions. */
  readonly markers?: readonly PlotterMarker[];
  /** External cursor timestamp in log microseconds; set by map-track sync. */
  readonly cursorUs?: number | null;
  /** Called when the user moves uPlot's cursor; `null` means no valid point. */
  readonly onCursor?: (timeUs: number | null) => void;
  /** Initial/fallback plot width in CSS pixels. */
  readonly width?: number;
  /** Initial/fallback plot height in CSS pixels. */
  readonly height?: number;
  /** Extra class for the outer region. */
  readonly class?: string;
}
