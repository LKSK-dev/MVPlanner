/**
 * `ui/screens/logs/playback` public surface (task T6.6; spec plan/04 §4.7/§4.8).
 *
 * The tlog playback control bar + preset-analysis selector. Cross-module
 * consumers (the Logs screen assembly T6.8, the plotter T6.4) import from here,
 * never deep paths (conventions plan/implementation/00 §0.3):
 *
 *  - {@link PlaybackControls} — the Solid control bar (play/pause/step/scrub/
 *    speed + time readout + preset selector). Drive it with a
 *    {@link PlaybackController}.
 *  - {@link createReplayController} / {@link openTlog} / {@link loadTlogBytes} —
 *    wiring helpers to back the controller with a real `ReplayTransport`.
 *  - {@link ANALYSIS_PRESETS} / {@link presetFieldSpec} — preset definitions and
 *    the field-selection spec the plotter consumes.
 *  - The pure timeline state machine (re-exported) for tests + advanced wiring.
 *
 * Importing this barrel registers the `logs.playback.*` i18n strings.
 *
 * @see ./README.md for the control API, the preset field-spec shape, and how to
 *   test.
 */
import './messages';
import './playback.css';

export { PlaybackControls, type PlaybackControlsProps, type TFn } from './playback';

export {
  createReplayController,
  openTlog,
  loadTlogBytes,
  tlogTotalUs,
  type PlaybackController,
  type PlaybackProgress,
  type ReplayController,
  type ReplayPlaybackTransport,
  type OpenableReplayTransport,
  type OpenTlogOptions,
} from './controller';

export {
  ANALYSIS_PRESETS,
  getPreset,
  presetFieldSpec,
  type AnalysisPreset,
  type AnalysisFieldSpec,
  type PresetSeries,
  type FieldRef,
} from './presets';

export {
  PLAYBACK_SPEEDS,
  MIN_SPEED,
  MAX_SPEED,
  clampSpeed,
  clampPosition,
  initialTimeline,
  withTotal,
  play,
  pause,
  togglePlay,
  setSpeed,
  seek,
  stepped,
  withProgress,
  formatTimecode,
  type TimelineState,
} from './timeline';

export { PLAYBACK_MESSAGES } from './messages';
