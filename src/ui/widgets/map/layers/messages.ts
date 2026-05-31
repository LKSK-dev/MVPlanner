/**
 * Map overlay + tools i18n strings (task T2.4; conventions plan/implementation/00
 * §0.3, spec plan/05 §5.9). The overlays own their `mapoverlay.*` keys and
 * contribute them at IMPORT TIME via the public {@link registerMessages} seam —
 * no edit to the central English catalog. Importing the layers/tools barrels
 * pulls this module, so `t('mapoverlay.*')` resolves wherever overlays are used.
 *
 * The measure/marker readouts are intended for an `aria-live` region (the map
 * widget already provides one), so screen-reader users get the tool feedback
 * the canvas conveys visually.
 */
import { registerMessages } from '../../../../core/i18n';

/** The shipped English `mapoverlay.*` strings. */
export const MAP_OVERLAY_MESSAGES: Readonly<Record<string, string>> = {
  // Layer labels (a11y / legend).
  'mapoverlay.vehicle.label': 'Vehicle',
  'mapoverlay.home.label': 'Home',
  'mapoverlay.track.label': 'Flight track',
  'mapoverlay.mission.label': 'Mission path',
  'mapoverlay.fence.label': 'Geofence',
  'mapoverlay.rally.label': 'Rally points',

  // Tool names (for buttons / command palette).
  'mapoverlay.tool.none': 'Pan',
  'mapoverlay.tool.measureDistance': 'Measure distance',
  'mapoverlay.tool.measureArea': 'Measure area',
  'mapoverlay.tool.marker': 'Drop marker',

  // Live readouts (announced via the map aria-live region).
  'mapoverlay.measure.distance': 'Distance: {value}',
  'mapoverlay.measure.area': 'Area: {value}',
  'mapoverlay.measure.empty': 'Click the map to measure',
  'mapoverlay.marker.placed': 'Marker placed at {lat}, {lon}',
};

registerMessages(MAP_OVERLAY_MESSAGES);
