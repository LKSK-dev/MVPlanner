/**
 * Map widget i18n strings (task T2.3; conventions plan/implementation/00 §0.3,
 * spec plan/05 §5.9). The widget owns its `map.*` keys and contributes them at
 * IMPORT TIME via the public {@link registerMessages} seam — no edit to the
 * central English catalog or the i18n internals. Importing this module (the
 * component does) is enough to make `t('map.*')` resolve.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `map.*` strings. */
export const MAP_MESSAGES: Readonly<Record<string, string>> = {
  'map.label': 'Map',
  'map.a11y.label': 'Interactive map. Use arrow keys to pan, plus and minus to zoom.',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.readout': 'Center {lat}, {lon} \u00b7 zoom {zoom}',
  'map.offline': 'Offline \u2014 showing cached tiles',
  'map.attribution': '\u00a9 OpenStreetMap contributors',
};

registerMessages(MAP_MESSAGES);
