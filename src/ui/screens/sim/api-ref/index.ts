/**
 * `ui/screens/sim/api-ref` public surface (task T7.5).
 *
 * The API reference is implemented under the Sim screen namespace because it is
 * developer tooling for extension authors rather than a flight-critical widget.
 * Importing this barrel registers the `apiref.*` i18n messages as a side effect.
 */
import './messages';

export { ApiReference, type ApiReferenceProps, type ApiReferenceT } from './api-reference';
export {
  API_REFERENCE_COMMAND_ID,
  API_REFERENCE_PANEL_ID,
  buildBundledApiReferenceMembers,
  createApiReferencePanel,
  registerApiReference,
  type ApiReferencePanelOptions,
  type ApiReferenceRegistrationOptions,
} from './register';
export {
  API_REFERENCE_GROUP_ORDER,
  extractApiReferenceMembers,
  filterApiReferenceMembers,
  formatApiReferencePermission,
  type ApiReferenceGroup,
  type ApiReferenceMember,
  type ApiReferencePermission,
} from './model';
export { API_REFERENCE_MESSAGES, registerApiReferenceMessages } from './messages';
