/**
 * `ui/widgets/map/tools` public surface (task T2.4; spec plan/04 §4.2 map tools).
 * The measure-distance / measure-area / drop-marker tools deferred from T2.3,
 * plus the **map click-intent** surface the Flight screen/actions (T2.7/T2.11)
 * consume for guided "fly here" / set-ROI. See {@link createMapTools}.
 *
 * Importing this module registers the `mapoverlay.*` i18n strings (shared with
 * the overlay layers).
 */
export {
  createMapTools,
  type MapMarker,
  type MapToolHost,
  type MapTools,
  type MapToolsOptions,
  type TFn,
  type ToolMode,
} from './tools';
