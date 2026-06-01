/**
 * `ui/widgets/plotter` public surface (task T6.4; spec plan/04 §4.8,
 * plan/05 §5.5). uPlot-based multi-axis DataFlash log plotter with pure
 * transforms for query-series buckets, cursor mapping, and marker normalization.
 *
 * Cross-module consumers import from here, never deep paths. Importing this
 * module registers `plotter.*` i18n strings and includes uPlot/widget CSS so the
 * single-file build inlines the plotter styling.
 */
import './messages';
import 'uplot/dist/uPlot.min.css';
import './plotter.css';

export { Plotter } from './plotter';
export { PLOTTER_MESSAGES } from './messages';
export { createMarkerDrawHook } from './markers';
export {
  alignSeriesToCommonX,
  buildPlotterModel,
  buildPlotterOptions,
  colorForSeries,
  cursorIndexToTime,
  cursorTimeToIndex,
  formatTimeUs,
  normalizePlotterMarkers,
  plottedValue,
  plotterSummary,
  scaleKeyForAxis,
} from './transform';
export type {
  NormalizedPlotterMarker,
  PlotterAlignedSeries,
  PlotterMarker,
  PlotterMarkerKind,
  PlotterModel,
  PlotterProps,
  PlotterSeriesInput,
  PlotterUPlotData,
} from './types';
