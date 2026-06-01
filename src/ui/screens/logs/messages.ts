/**
 * Logs screen i18n strings (task T6.8; conventions plan/implementation/00 §0.3,
 * spec plan/05 §5.4/§5.9).
 *
 * The Logs screen assembly + its source/series pickers own the `logs.*`
 * namespace (the `logs.playback.*` sub-namespace is owned by the playback
 * module) and contribute it at IMPORT TIME via the public {@link
 * registerMessages} seam — never editing the central catalog. Registration is
 * additive and idempotent.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `logs.*` strings (excluding `logs.playback.*`). */
export const LOGS_MESSAGES: Readonly<Record<string, string>> = {
  // --- screen regions ------------------------------------------------------
  'logs.region': 'Logs & analysis',
  'logs.plotter.label': 'Log plotter',
  'logs.map.label': 'Flight track map',
  'logs.inspector.label': 'MAVLink inspector',
  'logs.sender.label': 'Message sender',
  'logs.playbackBar.label': 'Playback & presets',

  // --- source picker -------------------------------------------------------
  'logs.source.label': 'Log source',
  'logs.source.openBin': 'Open DataFlash log…',
  'logs.source.openTlog': 'Open telemetry log…',
  'logs.source.loading': 'Decoding log…',
  'logs.source.loaded': 'Loaded {name} ({series} series)',
  'logs.source.tlogLoaded': 'Loaded {name}',
  'logs.source.empty': 'No log opened',
  'logs.source.error': 'Could not open the log.',
  'logs.source.export': 'Export CSV',

  // --- series picker -------------------------------------------------------
  'logs.series.label': 'Series',
  'logs.series.search': 'Search message.field',
  'logs.series.searchPlaceholder': 'Filter…',
  'logs.series.add': 'Add {series}',
  'logs.series.remove': 'Remove {series}',
  'logs.series.selected': 'Plotted series',
  'logs.series.none': 'Open a DataFlash log to pick series.',
  'logs.series.noMatch': 'No matching series.',
  'logs.derived.label': 'Derived expression',
  'logs.derived.placeholder': 'ATT.Roll - ATT.DesRoll',
  'logs.derived.add': 'Add derived series',
  'logs.derived.error': 'Invalid derived expression.',
};

registerMessages(LOGS_MESSAGES);
