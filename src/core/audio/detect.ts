/**
 * Pure alert detection for voice/audio alerts (task T8.7).
 *
 * Given a previous + next {@link VehicleState} and optional `STATUSTEXT` events,
 * this module returns alert descriptions only. It performs no I/O and owns no
 * mutable state; callers supply `lastFiredMs` to get deterministic rate limiting.
 */
import type { VehicleState } from '../../contracts';
import type {
  AudioAlert,
  AudioAlertCategory,
  AudioAlertKind,
  AudioBatteryThresholds,
  AudioDetectionThresholds,
  AudioLastFired,
  AudioRateLimits,
  AudioTonePattern,
  DetectAlertsOptions,
  StatusTextAlertInput,
} from './types';

/** Default battery/GPS thresholds for alert detection. */
export const DEFAULT_AUDIO_THRESHOLDS: AudioDetectionThresholds = Object.freeze({
  battery: Object.freeze({ lowPct: 20, criticalPct: 10 }),
  minGpsFix: 3,
});

/** Default category rate limits in milliseconds. */
export const DEFAULT_AUDIO_RATE_LIMIT_MS: Readonly<Record<AudioAlertCategory, number>> =
  Object.freeze({
    mode: 3_000,
    arm: 2_000,
    failsafe: 30_000,
    battery: 30_000,
    gps: 30_000,
    ekf: 30_000,
  });

const DEFAULT_RATE_LIMIT_MS = 30_000;
const MAV_SEVERITY_WARNING = 4;

function statusEvents(input: DetectAlertsOptions['statusText']): readonly StatusTextAlertInput[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input as readonly StatusTextAlertInput[];
  return [input as StatusTextAlertInput];
}

function thresholdOptions(options: DetectAlertsOptions): AudioDetectionThresholds {
  const batteryPatch = options.thresholds?.battery;
  const battery: AudioBatteryThresholds = {
    lowPct: batteryPatch?.lowPct ?? DEFAULT_AUDIO_THRESHOLDS.battery.lowPct,
    criticalPct: batteryPatch?.criticalPct ?? DEFAULT_AUDIO_THRESHOLDS.battery.criticalPct,
  };
  return {
    battery,
    minGpsFix: options.thresholds?.minGpsFix ?? DEFAULT_AUDIO_THRESHOLDS.minGpsFix,
  };
}

function lastFiredAt(last: AudioLastFired | undefined, key: string): number | undefined {
  if (last === undefined) return undefined;
  if (last instanceof Map) return last.get(key);
  return (last as Record<string, number | undefined>)[key];
}

function limitFor(
  category: AudioAlertCategory,
  rateLimits: AudioRateLimits | undefined,
  defaultRateLimitMs: number | undefined,
): number {
  return (
    rateLimits?.[category] ??
    defaultRateLimitMs ??
    DEFAULT_AUDIO_RATE_LIMIT_MS[category] ??
    DEFAULT_RATE_LIMIT_MS
  );
}

function isRateLimited(alert: AudioAlert, options: DetectAlertsOptions): boolean {
  const previous = lastFiredAt(options.lastFiredMs, alert.key);
  if (previous === undefined) return false;
  const elapsed = options.nowMs - previous;
  return (
    elapsed >= 0 &&
    elapsed < limitFor(alert.category, options.rateLimitsMs, options.defaultRateLimitMs)
  );
}

function vehicleKey(state: VehicleState | undefined, fallback?: StatusTextAlertInput): string {
  const sysid = fallback?.sysid ?? state?.sysid;
  const compid = fallback?.compid ?? state?.compid;
  if (sysid === undefined || compid === undefined) return 'vehicle:unknown';
  return `vehicle:${sysid}:${compid}`;
}

function alertBase(
  next: VehicleState | undefined,
  event: StatusTextAlertInput | undefined,
): Pick<AudioAlert, 'sysid' | 'compid'> {
  const sysid = event?.sysid ?? next?.sysid;
  const compid = event?.compid ?? next?.compid;
  return {
    ...(sysid !== undefined ? { sysid } : {}),
    ...(compid !== undefined ? { compid } : {}),
  };
}

interface BuildAlertInput {
  readonly state?: VehicleState | undefined;
  readonly event?: StatusTextAlertInput | undefined;
  readonly kind: AudioAlertKind;
  readonly category: AudioAlertCategory;
  readonly tone: AudioTonePattern;
  readonly messageKey: string;
  readonly fallback: string;
  readonly nowMs: number;
  readonly keyDetail?: string | undefined;
  readonly vars?: Readonly<Record<string, string | number>> | undefined;
}

function makeAlert(input: BuildAlertInput): AudioAlert {
  const keyDetail = input.keyDetail ?? input.kind;
  return Object.freeze({
    ...alertBase(input.state, input.event),
    key: `${vehicleKey(input.state, input.event)}:${input.kind}:${keyDetail}`,
    kind: input.kind,
    category: input.category,
    tone: input.tone,
    messageKey: input.messageKey,
    ...(input.vars !== undefined ? { vars: input.vars } : {}),
    fallback: input.fallback,
    tMs: input.nowMs,
  });
}

function addAlert(
  out: AudioAlert[],
  seen: Set<string>,
  alert: AudioAlert,
  options: DetectAlertsOptions,
): void {
  if (seen.has(alert.key) || isRateLimited(alert, options)) return;
  seen.add(alert.key);
  out.push(alert);
}

function pct(state: VehicleState | undefined): number | undefined {
  const value = state?.battery?.remainingPct;
  return value === undefined ? undefined : Math.max(0, Math.min(100, value));
}

function crossedBelow(
  prev: number | undefined,
  next: number | undefined,
  threshold: number,
): boolean {
  if (next === undefined || next > threshold) return false;
  return prev === undefined || prev > threshold;
}

function detectBattery(
  prev: VehicleState | undefined,
  next: VehicleState,
  thresholds: AudioBatteryThresholds,
  options: DetectAlertsOptions,
  out: AudioAlert[],
  seen: Set<string>,
): void {
  const prevPct = pct(prev);
  const nextPct = pct(next);
  if (crossedBelow(prevPct, nextPct, thresholds.criticalPct)) {
    const remaining = nextPct ?? thresholds.criticalPct;
    addAlert(
      out,
      seen,
      makeAlert({
        state: next,
        kind: 'battery-critical',
        category: 'battery',
        tone: 'critical',
        messageKey: 'audio.alert.batteryCritical',
        fallback: `Battery critical: ${remaining}% remaining`,
        vars: { pct: remaining },
        nowMs: options.nowMs,
      }),
      options,
    );
    return;
  }
  if (crossedBelow(prevPct, nextPct, thresholds.lowPct)) {
    const remaining = nextPct ?? thresholds.lowPct;
    addAlert(
      out,
      seen,
      makeAlert({
        state: next,
        kind: 'battery-low',
        category: 'battery',
        tone: 'warning',
        messageKey: 'audio.alert.batteryLow',
        fallback: `Battery low: ${remaining}% remaining`,
        vars: { pct: remaining },
        nowMs: options.nowMs,
      }),
      options,
    );
  }
}

function detectVehicleTransition(
  prev: VehicleState | undefined,
  next: VehicleState,
  thresholds: AudioDetectionThresholds,
  options: DetectAlertsOptions,
  out: AudioAlert[],
  seen: Set<string>,
): void {
  if (prev !== undefined && prev.mode !== next.mode) {
    addAlert(
      out,
      seen,
      makeAlert({
        state: next,
        kind: 'mode-change',
        category: 'mode',
        tone: 'info',
        messageKey: 'audio.alert.modeChange',
        fallback: `Mode changed to ${next.mode}`,
        vars: { mode: next.mode },
        nowMs: options.nowMs,
      }),
      options,
    );
  }

  if (prev !== undefined && prev.armed !== next.armed) {
    const kind: AudioAlertKind = next.armed ? 'armed' : 'disarmed';
    addAlert(
      out,
      seen,
      makeAlert({
        state: next,
        kind,
        category: 'arm',
        tone: next.armed ? 'warning' : 'info',
        messageKey: next.armed ? 'audio.alert.armed' : 'audio.alert.disarmed',
        fallback: next.armed ? 'Vehicle armed' : 'Vehicle disarmed',
        nowMs: options.nowMs,
      }),
      options,
    );
  }

  detectBattery(prev, next, thresholds.battery, options, out, seen);

  const prevFix = prev?.gps?.fix;
  const nextFix = next.gps?.fix;
  const gpsLost =
    (prevFix !== undefined &&
      prevFix >= thresholds.minGpsFix &&
      nextFix !== undefined &&
      nextFix < thresholds.minGpsFix) ||
    (prev?.gps !== undefined &&
      prevFix !== undefined &&
      prevFix >= thresholds.minGpsFix &&
      next.gps === undefined);
  if (gpsLost) {
    addAlert(
      out,
      seen,
      makeAlert({
        state: next,
        kind: 'gps-lost',
        category: 'gps',
        tone: 'critical',
        messageKey: 'audio.alert.gpsLost',
        fallback: 'GPS fix lost',
        nowMs: options.nowMs,
      }),
      options,
    );
  }

  if (prev?.ekfOk === true && next.ekfOk === false) {
    addAlert(
      out,
      seen,
      makeAlert({
        state: next,
        kind: 'ekf-unhealthy',
        category: 'ekf',
        tone: 'critical',
        messageKey: 'audio.alert.ekfUnhealthy',
        fallback: 'EKF unhealthy',
        nowMs: options.nowMs,
      }),
      options,
    );
  }
}

function classifyFailsafe(text: string): AudioAlertKind {
  const lower = text.toLocaleLowerCase();
  if (/\b(rc|radio)\b/.test(lower)) return 'failsafe-rc';
  if (/\b(batt|battery|power)\b/.test(lower)) return 'failsafe-battery';
  if (/\b(gcs|ground control|telemetry)\b/.test(lower)) return 'failsafe-gcs';
  if (/\b(ekf|gps)\b/.test(lower)) return 'failsafe-ekf';
  return 'failsafe-generic';
}

function failsafeMessage(kind: AudioAlertKind): { key: string; fallback: string } {
  switch (kind) {
    case 'failsafe-rc':
      return { key: 'audio.alert.failsafeRc', fallback: 'RC failsafe' };
    case 'failsafe-battery':
      return { key: 'audio.alert.failsafeBattery', fallback: 'Battery failsafe' };
    case 'failsafe-gcs':
      return { key: 'audio.alert.failsafeGcs', fallback: 'GCS failsafe' };
    case 'failsafe-ekf':
      return { key: 'audio.alert.failsafeEkf', fallback: 'EKF or GPS failsafe' };
    default:
      return { key: 'audio.alert.failsafe', fallback: 'Failsafe' };
  }
}

function statusTextAlert(
  event: StatusTextAlertInput,
  state: VehicleState | undefined,
  options: DetectAlertsOptions,
): AudioAlert | undefined {
  if (event.severity > MAV_SEVERITY_WARNING) return undefined;
  const lower = event.text.toLocaleLowerCase();
  if (/fail[ -]?safe/.test(lower)) {
    const kind = classifyFailsafe(event.text);
    const msg = failsafeMessage(kind);
    return makeAlert({
      state,
      event,
      kind,
      category: 'failsafe',
      tone: 'critical',
      messageKey: msg.key,
      fallback: msg.fallback,
      nowMs: options.nowMs,
      keyDetail: kind,
    });
  }
  if (/\b(critical|low)\b.*\b(batt|battery)\b|\b(batt|battery)\b.*\b(critical|low)\b/.test(lower)) {
    const critical = lower.includes('critical');
    return makeAlert({
      state,
      event,
      kind: critical ? 'battery-critical' : 'battery-low',
      category: 'battery',
      tone: critical ? 'critical' : 'warning',
      messageKey: critical ? 'audio.alert.batteryCriticalText' : 'audio.alert.batteryLowText',
      fallback: critical ? 'Battery critical' : 'Battery low',
      nowMs: options.nowMs,
    });
  }
  if (
    /\bgps\b.*\b(lost|loss|glitch|fail|unhealthy)\b|\b(lost|loss|glitch|fail|unhealthy)\b.*\bgps\b/.test(
      lower,
    )
  ) {
    return makeAlert({
      state,
      event,
      kind: 'gps-lost',
      category: 'gps',
      tone: 'critical',
      messageKey: 'audio.alert.gpsLost',
      fallback: 'GPS fix lost',
      nowMs: options.nowMs,
    });
  }
  if (
    /\bekf\b.*\b(unhealthy|fail|variance|error)\b|\b(unhealthy|fail|variance|error)\b.*\bekf\b/.test(
      lower,
    )
  ) {
    return makeAlert({
      state,
      event,
      kind: 'ekf-unhealthy',
      category: 'ekf',
      tone: 'critical',
      messageKey: 'audio.alert.ekfUnhealthy',
      fallback: 'EKF unhealthy',
      nowMs: options.nowMs,
    });
  }
  return undefined;
}

/**
 * Detect alert-worthy telemetry/event transitions without side effects.
 *
 * The returned list is deduped within this call and filtered by the supplied
 * `lastFiredMs` + rate-limit options. The function does not mutate that history;
 * services should record fired alert keys after applying user mutes.
 */
export function detectAlerts(
  prev: VehicleState | undefined,
  next: VehicleState,
  options: DetectAlertsOptions,
): readonly AudioAlert[] {
  const out: AudioAlert[] = [];
  const seen = new Set<string>();
  const thresholds = thresholdOptions(options);

  detectVehicleTransition(prev, next, thresholds, options, out, seen);
  for (const event of statusEvents(options.statusText)) {
    const alert = statusTextAlert(event, next, options);
    if (alert !== undefined) addAlert(out, seen, alert, options);
  }

  return Object.freeze(out);
}

/** Detect alerts from STATUSTEXT-like events when no vehicle transition occurred. */
export function detectStatusTextAlerts(
  event: StatusTextAlertInput,
  vehicle: VehicleState | undefined,
  options: Omit<DetectAlertsOptions, 'statusText'>,
): readonly AudioAlert[] {
  const out: AudioAlert[] = [];
  const seen = new Set<string>();
  const alert = statusTextAlert(event, vehicle, { ...options, statusText: event });
  if (alert !== undefined) addAlert(out, seen, alert, { ...options, statusText: event });
  return Object.freeze(out);
}
