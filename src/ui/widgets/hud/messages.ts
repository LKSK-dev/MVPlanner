/**
 * HUD i18n strings (task T2.1; conventions plan/implementation/00 §0.3,
 * spec plan/05 §5.9).
 *
 * The widget owns its `hud.*` keys and contributes them at IMPORT TIME via
 * {@link registerMessages} — no edit to the central English catalog (which the
 * inspector predates this convention by inlining). Importing this module (the
 * component does) is enough to make `t('hud.*')` resolve.
 */
import { registerMessages } from '../../../core/i18n';
import type { HudLabels } from './model';
import { DEFAULT_HUD_LABELS } from './model';
import type { TFn } from './types';

/** The shipped English `hud.*` strings. */
export const HUD_MESSAGES: Record<string, string> = {
  'hud.title': 'Head-up display',
  'hud.armed': 'ARMED',
  'hud.disarmed': 'DISARMED',
  'hud.mode': 'Mode',
  'hud.airspeed': 'AS',
  'hud.groundspeed': 'GS',
  'hud.altRel': 'ALT',
  'hud.altAmsl': 'AMSL',
  'hud.climb': 'CLB',
  'hud.throttle': 'THR',
  'hud.battery': 'BAT',
  'hud.gps': 'GPS',
  'hud.ekf': 'EKF',
  'hud.vibe': 'VIB',
  'hud.heading': 'HDG',
  'hud.time': 'TIME',
  'hud.noVehicle': 'No vehicle data',
  'hud.a11y.altitude': 'altitude',
  'hud.a11y.speed': 'speed',
  'hud.a11y.battery': 'battery',
  'hud.a11y.summary': 'Head-up display: {summary}',
};

registerMessages(HUD_MESSAGES);

/**
 * Resolve {@link HudLabels} from a translate function. Falls back to the English
 * {@link DEFAULT_HUD_LABELS} for any key that resolves to itself (i.e. missing).
 */
export function buildHudLabels(t: TFn): HudLabels {
  const tr = (key: string, fallback: string): string => {
    const v = t(key);
    return v === key ? fallback : v;
  };
  return {
    armed: tr('hud.armed', DEFAULT_HUD_LABELS.armed),
    disarmed: tr('hud.disarmed', DEFAULT_HUD_LABELS.disarmed),
    mode: tr('hud.mode', DEFAULT_HUD_LABELS.mode),
    airspeed: tr('hud.airspeed', DEFAULT_HUD_LABELS.airspeed),
    groundspeed: tr('hud.groundspeed', DEFAULT_HUD_LABELS.groundspeed),
    altRel: tr('hud.altRel', DEFAULT_HUD_LABELS.altRel),
    altAmsl: tr('hud.altAmsl', DEFAULT_HUD_LABELS.altAmsl),
    climb: tr('hud.climb', DEFAULT_HUD_LABELS.climb),
    throttle: tr('hud.throttle', DEFAULT_HUD_LABELS.throttle),
    battery: tr('hud.battery', DEFAULT_HUD_LABELS.battery),
    gps: tr('hud.gps', DEFAULT_HUD_LABELS.gps),
    ekf: tr('hud.ekf', DEFAULT_HUD_LABELS.ekf),
    vibe: tr('hud.vibe', DEFAULT_HUD_LABELS.vibe),
    heading: tr('hud.heading', DEFAULT_HUD_LABELS.heading),
    time: tr('hud.time', DEFAULT_HUD_LABELS.time),
    noVehicle: tr('hud.noVehicle', DEFAULT_HUD_LABELS.noVehicle),
    a11yAltitude: tr('hud.a11y.altitude', DEFAULT_HUD_LABELS.a11yAltitude),
    a11ySpeed: tr('hud.a11y.speed', DEFAULT_HUD_LABELS.a11ySpeed),
    a11yBattery: tr('hud.a11y.battery', DEFAULT_HUD_LABELS.a11yBattery),
  };
}
