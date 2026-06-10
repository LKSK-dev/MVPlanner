/**
 * Shared HUD widget types (task T2.1).
 */
import type { VehicleState } from '../../../contracts';
import type { TFn } from '../../../core/i18n';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type { TFn };

/** A reactive accessor for the current vehicle (or `undefined` when none). */
export type VehicleAccessor = () => VehicleState | undefined;

/** A reactive accessor for the current STATUSTEXT ticker line. */
export type StatusTextAccessor = () => string | undefined;
