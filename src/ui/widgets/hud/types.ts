/**
 * Shared HUD widget types (task T2.1).
 */
import type { VehicleState } from '../../../contracts';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** A reactive accessor for the current vehicle (or `undefined` when none). */
export type VehicleAccessor = () => VehicleState | undefined;

/** A reactive accessor for the current STATUSTEXT ticker line. */
export type StatusTextAccessor = () => string | undefined;
