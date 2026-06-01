/**
 * Voice/audio-alert wiring (task T8.7 integration; spec plan/04 §4.2 Voice).
 *
 * Connects the pure {@link AudioAlertService} (from `src/core/audio`) to the
 * live app at the App/connection level:
 *
 *  - it drives {@link AudioAlertService.processVehicleState} (which runs the pure
 *    `detectAlerts` transition detector) on every ACTIVE-vehicle telemetry
 *    transition pushed into the shared {@link Store} by the connection provider;
 *  - it taps the host `STATUSTEXT` stream and feeds each event through
 *    {@link AudioAlertService.processStatusText};
 *  - it honours the app-wide `settings.audioAlerts` toggle as a global gate, so
 *    muting audio in Settings silences both spoken phrases and tones.
 *
 * Persistence (settings under the storage KV) and the actual speech/tone output
 * are owned by the service; this module is pure wiring + a disposer. It must be
 * called inside a Solid reactive owner (the {@link App} component) so the
 * telemetry effect is cleaned up automatically; the returned disposer detaches
 * the `STATUSTEXT` tap.
 */
import { createEffect } from 'solid-js';
import type { AppState, DecodedMessage, FieldValue, Store, VehicleState } from '../../../contracts';
import type { AudioAlertService, StatusTextAlertInput } from '../../../core/audio';

/** The minimal host slice the audio wiring taps (the real host satisfies it). */
export interface AudioAlertHostSlice {
  /** Subscribe a selective decoded-message tap; returns an unsubscribe fn. */
  onMessage(names: readonly string[], cb: (msg: DecodedMessage) => void): () => void;
}

/** Construction dependencies for {@link wireAudioAlerts}. */
export interface AudioAlertWiringDeps {
  /** The pure audio-alert service (already constructed + settings loaded). */
  readonly service: AudioAlertService;
  /** The MAVLink host slice (`STATUSTEXT` tap). */
  readonly host: AudioAlertHostSlice;
  /** The shared app store (active-vehicle transitions + the audio toggle). */
  readonly store: Store<AppState>;
}

/** Read a MAVLink scalar field as a number (coercing bigint); else `undefined`. */
function numberField(value: FieldValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

/** Decode a `STATUSTEXT.text` field (string or NUL-padded char array) to text. */
function textField(value: FieldValue | undefined): string {
  if (typeof value === 'string') return value.replaceAll('\u0000', '').trim();
  if (Array.isArray(value)) {
    const codes = value.filter((n): n is number => typeof n === 'number' && n > 0);
    return String.fromCharCode(...codes).trim();
  }
  return '';
}

/** Build a {@link StatusTextAlertInput} from a decoded `STATUSTEXT`, or skip it. */
function statusTextFrom(msg: DecodedMessage): StatusTextAlertInput | undefined {
  const severity = numberField(msg.fields.severity);
  if (severity === undefined) return undefined;
  return { severity, text: textField(msg.fields.text), sysid: msg.sysid, compid: msg.compid };
}

/** Resolve the store's currently-active vehicle (non-reactive snapshot read). */
function activeVehicleOf(store: Store<AppState>): VehicleState | undefined {
  const s = store.get();
  if (s.activeSysid === undefined) return undefined;
  return s.vehicles[s.activeSysid];
}

/**
 * Wire the audio-alert service to live telemetry + `STATUSTEXT`. Call ONCE
 * inside the {@link App} reactive owner; the returned disposer detaches the
 * `STATUSTEXT` tap (the telemetry effect is owned by the caller's root).
 */
export function wireAudioAlerts(deps: AudioAlertWiringDeps): () => void {
  const { service, host, store } = deps;

  // The app-wide audio toggle gates both the spoken phrases and the tones; the
  // service keeps its own finer-grained settings, but this is the operator's
  // master switch (settings.audioAlerts, default on).
  const alertsEnabled = (): boolean => store.get().settings.audioAlerts;

  const activeVehicle = store.select((s) => {
    if (s.activeSysid === undefined) return undefined;
    return s.vehicles[s.activeSysid];
  });

  // Drive the pure transition detector on every active-vehicle update.
  createEffect(() => {
    const v = activeVehicle();
    if (v === undefined) return;
    if (!alertsEnabled()) return;
    void service.processVehicleState(v);
  });

  const offStatus = host.onMessage(['STATUSTEXT'], (msg) => {
    if (!alertsEnabled()) return;
    const event = statusTextFrom(msg);
    if (event === undefined) return;
    void service.processStatusText(event, activeVehicleOf(store));
  });

  return () => {
    offStatus();
  };
}
