/**
 * Audio-alert value types (task T8.7; spec plan/04 §4.2 Voice / audio).
 *
 * The module is split into a pure detector and a side-effecting service. These
 * types are intentionally serialisable/test-friendly so alert decisions can be
 * covered without real browser audio devices.
 */
import type { KvStore, VehicleState } from '../../contracts';

/** Categories that can be muted independently by the operator. */
export type AudioAlertCategory = 'mode' | 'arm' | 'failsafe' | 'battery' | 'gps' | 'ekf';

/** Specific alert transition detected from telemetry or events. */
export type AudioAlertKind =
  | 'mode-change'
  | 'armed'
  | 'disarmed'
  | 'failsafe-rc'
  | 'failsafe-battery'
  | 'failsafe-gcs'
  | 'failsafe-ekf'
  | 'failsafe-generic'
  | 'battery-low'
  | 'battery-critical'
  | 'gps-lost'
  | 'ekf-unhealthy';

/** Tone pattern requested for an alert. */
export type AudioTonePattern = 'info' | 'warning' | 'critical';

/** MAVLink `STATUSTEXT`-like event payload consumed by the detector. */
export interface StatusTextAlertInput {
  /** MAV_SEVERITY numeric value: 0 emergency … 7 debug. */
  readonly severity: number;
  /** STATUSTEXT text. */
  readonly text: string;
  /** Optional source system. Falls back to the associated vehicle state. */
  readonly sysid?: number;
  /** Optional source component. Falls back to the associated vehicle state. */
  readonly compid?: number;
}

/** One alert the audio layer should fire. */
export interface AudioAlert {
  /** Stable rate-limit/deduplication key. */
  readonly key: string;
  /** Alert kind. */
  readonly kind: AudioAlertKind;
  /** Mute category. */
  readonly category: AudioAlertCategory;
  /** Suggested urgency. */
  readonly tone: AudioTonePattern;
  /** i18n key for the spoken phrase. */
  readonly messageKey: string;
  /** i18n interpolation variables. */
  readonly vars?: Readonly<Record<string, string | number>>;
  /** English fallback for non-i18n consumers/tests. */
  readonly fallback: string;
  /** Detection time in milliseconds. */
  readonly tMs: number;
  /** Source vehicle system id, when known. */
  readonly sysid?: number;
  /** Source vehicle component id, when known. */
  readonly compid?: number;
}

/** Battery thresholds used by the detector. */
export interface AudioBatteryThresholds {
  /** Remaining-percent threshold for a low-battery warning. */
  readonly lowPct: number;
  /** Remaining-percent threshold for a critical-battery warning. */
  readonly criticalPct: number;
}

/** Detector thresholds that can be overridden by settings/tests. */
export interface AudioDetectionThresholds {
  /** Battery remaining-percent thresholds. */
  readonly battery: AudioBatteryThresholds;
  /** Minimum GPS fix type considered healthy. Defaults to 3 (3D fix). */
  readonly minGpsFix: number;
}

/** Per-category rate limits in milliseconds. */
export type AudioRateLimits = Readonly<Partial<Record<AudioAlertCategory, number>>>;

/** Last-fired lookup accepted by the pure detector. */
export type AudioLastFired = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

/** Options for pure alert detection. */
export interface DetectAlertsOptions {
  /** Detection time in milliseconds. */
  readonly nowMs: number;
  /** Previously fired alert times keyed by {@link AudioAlert.key}. */
  readonly lastFiredMs?: AudioLastFired;
  /** Default rate limit for categories not present in {@link rateLimitsMs}. */
  readonly defaultRateLimitMs?: number;
  /** Optional per-category rate limits. */
  readonly rateLimitsMs?: AudioRateLimits;
  /** Optional threshold overrides. */
  readonly thresholds?: Partial<{
    readonly battery: Partial<AudioBatteryThresholds>;
    readonly minGpsFix: number;
  }>;
  /** STATUSTEXT-like event(s) to classify alongside the vehicle transition. */
  readonly statusText?: StatusTextAlertInput | readonly StatusTextAlertInput[];
}

/** Persisted/mutable audio-alert settings. */
export interface AudioAlertSettings {
  /** Master service enable. */
  readonly enabled: boolean;
  /** Global mute suppresses both voice and tones without changing sub-settings. */
  readonly globalMute: boolean;
  /** Speak alert phrases via Web Speech (or injected speak function). */
  readonly voiceEnabled: boolean;
  /** Play short tone patterns (or injected tone function). */
  readonly tonesEnabled: boolean;
  /** Output volume, 0..1. */
  readonly volume: number;
  /** Per-category mute flags. */
  readonly mutedCategories: Readonly<Partial<Record<AudioAlertCategory, boolean>>>;
  /** Rate-limit settings. */
  readonly rateLimitsMs: AudioRateLimits;
  /** Detector thresholds. */
  readonly thresholds: AudioDetectionThresholds;
  /** Optional BCP-47 language tag for speech synthesis. */
  readonly speechLang?: string;
}

/** Partial settings accepted by update operations and persisted records. */
export type AudioAlertSettingsPatch = Partial<{
  readonly enabled: boolean;
  readonly globalMute: boolean;
  readonly voiceEnabled: boolean;
  readonly tonesEnabled: boolean;
  readonly volume: number;
  readonly mutedCategories: Readonly<Partial<Record<AudioAlertCategory, boolean>>>;
  readonly rateLimitsMs: AudioRateLimits;
  readonly thresholds: Partial<{
    readonly battery: Partial<AudioBatteryThresholds>;
    readonly minGpsFix: number;
  }>;
  readonly speechLang: string;
}>;

/** Function seam for spoken alerts. */
export type AudioSpeak = (
  text: string,
  options: Readonly<{ volume: number; lang?: string }>,
) => void | Promise<void>;

/** Function seam for tonal alerts. */
export type AudioTone = (
  alert: AudioAlert,
  options: Readonly<{ volume: number }>,
) => void | Promise<void>;

/** Clock seam used by the service. */
export type AudioClock = () => number;

/** Dependencies for {@link import('./service').AudioAlertService}. */
export interface AudioAlertServiceDeps {
  /** Persisted settings store. If omitted, settings are in-memory only. */
  readonly store?: KvStore;
  /** Speak implementation. Defaults to Web Speech API. */
  readonly speak?: AudioSpeak;
  /** Tone implementation. Defaults to an AudioContext beeper. */
  readonly tone?: AudioTone;
  /** Time source. Defaults to `Date.now`. */
  readonly now?: AudioClock;
  /** Translation function. Defaults to `t` from `src/core/i18n`. */
  readonly translate?: (key: string, vars?: Record<string, string | number>) => string;
  /** Initial settings layered on top of defaults before persisted settings load. */
  readonly settings?: AudioAlertSettingsPatch;
  /** KvStore namespace for settings. */
  readonly namespace?: string;
}

/** Snapshot returned by service handlers. */
export interface AudioAlertServiceResult {
  /** Alerts that passed settings/mute gates and were fired. */
  readonly fired: readonly AudioAlert[];
  /** Alerts detected before service-level mute/filter gates. */
  readonly detected: readonly AudioAlert[];
}

/** Public service contract. */
export interface AudioAlertService {
  /** Current immutable settings snapshot. */
  getSettings(): AudioAlertSettings;
  /** Load persisted settings, merging them with defaults/current initial settings. */
  loadSettings(): Promise<AudioAlertSettings>;
  /** Persist and apply a settings patch. */
  updateSettings(patch: AudioAlertSettingsPatch): Promise<AudioAlertSettings>;
  /** Set the global mute flag and persist it. */
  setGlobalMute(muted: boolean): Promise<AudioAlertSettings>;
  /** Mute/unmute one category and persist it. */
  setCategoryMuted(category: AudioAlertCategory, muted: boolean): Promise<AudioAlertSettings>;
  /** Process a new vehicle state against the previous state for that vehicle. */
  processVehicleState(
    next: VehicleState,
    options?: Readonly<{ statusText?: StatusTextAlertInput | readonly StatusTextAlertInput[] }>,
  ): Promise<AudioAlertServiceResult>;
  /** Process one STATUSTEXT-like event with an optional current vehicle state. */
  processStatusText(
    event: StatusTextAlertInput,
    vehicle?: VehicleState,
  ): Promise<AudioAlertServiceResult>;
  /** Forget previous vehicle snapshots and rate-limit history. */
  reset(): void;
}
