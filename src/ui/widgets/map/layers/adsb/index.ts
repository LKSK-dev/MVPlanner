/**
 * ADS-B traffic layer public surface (task T8.8). Importing this module
 * registers `adsb.*` i18n keys. The Flight map assembly can:
 *
 * 1. create a {@link TrafficStore};
 * 2. wire it with {@link connectTrafficStore}(mavlinkHost, store);
 * 3. add {@link createAdsbTrafficLayer} to the map engine; and
 * 4. use {@link projectTrafficTargets}, {@link pickTrafficTarget} and
 *    {@link trafficDetails} for hover/selection popovers.
 */
import './messages';

export {
  DEFAULT_TRAFFIC_STALE_TIMEOUT_MS,
  TrafficStore,
  connectTrafficStore,
  formatIcaoAddress,
  parseAdsbVehicleMessage,
  type AdsbMessageSource,
  type TrafficAircraft,
  type TrafficNow,
  type TrafficStoreOptions,
  type TrafficStoreTapOptions,
} from './store';

export {
  formatTrafficAltitude,
  pickTrafficTarget,
  projectTrafficTargets,
  trafficDetails,
  trafficIconPolygon,
  trafficLabel,
  type TrafficDetails,
  type TrafficProjectionOptions,
  type TrafficScreenTarget,
} from './geometry';

export { createAdsbTrafficLayer, type AdsbTrafficLayerOptions } from './layer';
export { ADSB_MESSAGES } from './messages';
