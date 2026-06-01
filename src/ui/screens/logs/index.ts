/**
 * `ui/screens/logs` public surface (task T6.5 + T6.8; spec plan/04 §4.7/§4.8/§4.9,
 * plan/05 §5.4 Logs). The composed Logs & analysis screen plus its source/series
 * pickers, the flight-track core, and the shell registration glue. Cross-module
 * consumers (notably {@link App}) import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `logs.*`
 * i18n strings as a side effect.
 *
 * @see ./logs-screen.tsx for the composition and how to test it.
 */
import './messages';

export { LogsScreen, type LogsScreenProps, type TFn } from './logs-screen';
export { createLogsScreenPanel, LOGS_SCREEN_PANEL_ID, type LogsScreenPanelDeps } from './register';
export { SeriesPicker, type SeriesPickerProps, type SelectedSeriesSummary } from './series-picker';
export {
  decodeDataFlashInWorker,
  decodeDataFlashOnMainThread,
  isDataFlashName,
  isTlogName,
} from './source';
export {
  buildTrackFromSeries,
  createTrackCursorLayer,
  findTrackSource,
  interpolateTrackAt,
  nearestTrackTime,
  type TrackCursorLayerOptions,
  type TrackSample,
  type TrackSource,
} from './track';
export { LOGS_MESSAGES } from './messages';
