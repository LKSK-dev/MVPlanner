/**
 * `mavlink/microservices/param` public surface (task T3.2; spec plan/03 §3.4
 * Parameters). The {@link ParamClient} implements the frozen `ParamClient`
 * contract over the classic `PARAM_REQUEST_LIST` / `PARAM_REQUEST_READ` /
 * `PARAM_VALUE` / `PARAM_SET` protocol: full fetch with missing-index retry,
 * cached `get`, confirmed `set`, and `onChange` subscription. Cross-module
 * consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 *
 * @see ./README.md for the contract, value-decoding decision, and how to test.
 */
export { ParamClient, ParamError, createParamClient } from './param-client';
export type {
  ParamClientDeps,
  ParamSendFn,
  ParamMessageTap,
  ParamTarget,
  ParamTargetAccessor,
  ParamClock,
  ParamErrorReason,
} from './param-client';
export { MAV_PARAM_TYPE } from './constants';
