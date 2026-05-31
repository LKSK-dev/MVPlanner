/**
 * `ui/screens/flight` public surface (task T2.11; spec plan/04 §4.2, plan/05
 * §5.4 Flight). The composed Flight Data screen plus its app/connection-scoped
 * services and the shell registration glue. Cross-module consumers (notably
 * {@link App}) import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `flight.*`
 * i18n strings as a side effect.
 *
 * @see ./README.md for the composition, service scoping and how to test it.
 */
import './messages';

export { FlightScreen, type FlightScreenProps, type TFn } from './flight-screen';
export {
  createFlightServices,
  type FlightServices,
  type FlightServicesDeps,
  type FlightServicesHandle,
  type FlightHost,
} from './services';
export {
  createFlightScreenPanel,
  FLIGHT_SCREEN_PANEL_ID,
  type FlightScreenPanelDeps,
} from './register';
export { FLIGHT_MESSAGES, registerFlightMessages } from './messages';

// Re-export the actions surface (already a side-effecting barrel) for one import
// site, mirroring the other screen barrels.
export { ActionsBar, AuditPanel, runAction } from './actions';
