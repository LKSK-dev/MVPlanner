/**
 * MAVLink message identifiers used by the manual-control microservice
 * (task T8.6; spec plan/04 §4.2 joystick).
 *
 * Ids are resolved from the bundled `common` {@link DialectTable} (single source
 * of truth), with the frozen MAVLink literal as a fallback. Frames are sent by
 * NAME through the host's `sendMessage`; the numeric ids double as documentation
 * of the exact wire messages this service emits.
 */
import type { DialectTable } from '../../../contracts';
import { commonDialect } from '../../dialects';

/** Resolve a message id by name, falling back to `fallback`. */
function msgId(d: DialectTable, name: string, fallback: number): number {
  for (const m of Object.values(d.messages)) if (m.name === name) return m.id;
  return fallback;
}

/** `RC_CHANNELS_OVERRIDE` message name (the wire message for RC mode). */
export const MSG_RC_CHANNELS_OVERRIDE = 'RC_CHANNELS_OVERRIDE';
/** `MANUAL_CONTROL` message name (the wire message for manual mode). */
export const MSG_MANUAL_CONTROL = 'MANUAL_CONTROL';

/** `RC_CHANNELS_OVERRIDE` (70) — overrides up to 18 RC channels with µs pulses. */
export const MSG_ID_RC_CHANNELS_OVERRIDE = msgId(commonDialect, MSG_RC_CHANNELS_OVERRIDE, 70);
/** `MANUAL_CONTROL` (69) — `x`/`y`/`z`/`r` (−1000…1000) + a 16-bit button mask. */
export const MSG_ID_MANUAL_CONTROL = msgId(commonDialect, MSG_MANUAL_CONTROL, 69);

/** Number of RC channels carried by `RC_CHANNELS_OVERRIDE` (`chan1_raw`…`chan18_raw`). */
export const RC_OVERRIDE_CHANNELS = 18;

/** Minimum send rate (Hz) the service will accept. */
export const MIN_RATE_HZ = 1;
/** Maximum send rate (Hz) the service will accept (transport-friendly cap). */
export const MAX_RATE_HZ = 50;
/** Default send rate (Hz) when none is configured. */
export const DEFAULT_RATE_HZ = 25;
