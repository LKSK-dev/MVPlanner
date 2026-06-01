/**
 * Voice/audio alert service (task T8.7; spec plan/04 §4.2).
 *
 * The service owns mutable settings, previous vehicle snapshots and rate-limit
 * history. Audio output and persistence are injected so tests never touch real
 * speech synthesis, speakers or IndexedDB.
 */
import type { KvStore, VehicleState } from '../../contracts';
import { t } from '../i18n';
import {
  DEFAULT_AUDIO_RATE_LIMIT_MS,
  DEFAULT_AUDIO_THRESHOLDS,
  detectAlerts,
  detectStatusTextAlerts,
} from './detect';
import './messages';
import { createDefaultTone, defaultSpeak } from './tone';
import type {
  AudioAlert,
  AudioAlertCategory,
  AudioAlertService,
  AudioAlertServiceDeps,
  AudioAlertServiceResult,
  AudioAlertSettings,
  AudioAlertSettingsPatch,
  AudioDetectionThresholds,
  AudioRateLimits,
  StatusTextAlertInput,
} from './types';

/** Default KvStore namespace for persisted audio settings. */
export const AUDIO_SETTINGS_NAMESPACE = 'core.audio';

/** Default KvStore key for persisted audio settings. */
export const AUDIO_SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS: AudioAlertSettings = Object.freeze({
  enabled: true,
  globalMute: false,
  voiceEnabled: true,
  tonesEnabled: true,
  volume: 0.8,
  mutedCategories: Object.freeze({}),
  rateLimitsMs: DEFAULT_AUDIO_RATE_LIMIT_MS,
  thresholds: DEFAULT_AUDIO_THRESHOLDS,
});

function vehicleMapKey(state: VehicleState): string {
  return `${state.sysid}:${state.compid}`;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.volume;
  return Math.max(0, Math.min(1, value));
}

function normalizeRateLimits(
  input: AudioRateLimits | undefined,
  base: AudioRateLimits,
): AudioRateLimits {
  return Object.freeze({
    ...base,
    ...(input?.mode !== undefined ? { mode: Math.max(0, input.mode) } : {}),
    ...(input?.arm !== undefined ? { arm: Math.max(0, input.arm) } : {}),
    ...(input?.failsafe !== undefined ? { failsafe: Math.max(0, input.failsafe) } : {}),
    ...(input?.battery !== undefined ? { battery: Math.max(0, input.battery) } : {}),
    ...(input?.gps !== undefined ? { gps: Math.max(0, input.gps) } : {}),
    ...(input?.ekf !== undefined ? { ekf: Math.max(0, input.ekf) } : {}),
  });
}

function normalizeThresholds(
  patch: AudioAlertSettingsPatch['thresholds'] | undefined,
  base: AudioDetectionThresholds,
): AudioDetectionThresholds {
  const lowPct = patch?.battery?.lowPct ?? base.battery.lowPct;
  const criticalPct = patch?.battery?.criticalPct ?? base.battery.criticalPct;
  const normalizedCritical = Math.max(0, Math.min(100, criticalPct));
  const normalizedLow = Math.max(normalizedCritical, Math.min(100, lowPct));
  return Object.freeze({
    battery: Object.freeze({ lowPct: normalizedLow, criticalPct: normalizedCritical }),
    minGpsFix: Math.max(0, patch?.minGpsFix ?? base.minGpsFix),
  });
}

function normalizeSettingsPatch(
  patch: AudioAlertSettingsPatch | undefined,
  base: AudioAlertSettings,
): AudioAlertSettings {
  return Object.freeze({
    enabled: patch?.enabled ?? base.enabled,
    globalMute: patch?.globalMute ?? base.globalMute,
    voiceEnabled: patch?.voiceEnabled ?? base.voiceEnabled,
    tonesEnabled: patch?.tonesEnabled ?? base.tonesEnabled,
    volume: patch?.volume === undefined ? base.volume : clampVolume(patch.volume),
    mutedCategories: Object.freeze({ ...base.mutedCategories, ...(patch?.mutedCategories ?? {}) }),
    rateLimitsMs: normalizeRateLimits(patch?.rateLimitsMs, base.rateLimitsMs),
    thresholds: normalizeThresholds(patch?.thresholds, base.thresholds),
    ...(patch?.speechLang !== undefined
      ? { speechLang: patch.speechLang }
      : base.speechLang !== undefined
        ? { speechLang: base.speechLang }
        : {}),
  });
}

function speechText(
  alert: AudioAlert,
  translate: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const translated = translate(alert.messageKey, alert.vars);
  return translated === alert.messageKey ? alert.fallback : translated;
}

function emptyResult(detected: readonly AudioAlert[] = []): AudioAlertServiceResult {
  return Object.freeze({ fired: Object.freeze([]), detected });
}

/** Concrete implementation of {@link AudioAlertService}. */
export class DefaultAudioAlertService implements AudioAlertService {
  private readonly store: KvStore | undefined;
  private readonly namespace: string;
  private readonly speak: NonNullable<AudioAlertServiceDeps['speak']>;
  private readonly tone: NonNullable<AudioAlertServiceDeps['tone']>;
  private readonly now: NonNullable<AudioAlertServiceDeps['now']>;
  private readonly translate: NonNullable<AudioAlertServiceDeps['translate']>;
  private settings: AudioAlertSettings;
  private readonly previous = new Map<string, VehicleState>();
  private readonly lastFired = new Map<string, number>();

  constructor(deps: AudioAlertServiceDeps = {}) {
    this.store = deps.store;
    this.namespace = deps.namespace ?? AUDIO_SETTINGS_NAMESPACE;
    this.speak = deps.speak ?? defaultSpeak;
    this.tone = deps.tone ?? createDefaultTone();
    this.now = deps.now ?? (() => Date.now());
    this.translate = deps.translate ?? t;
    this.settings = normalizeSettingsPatch(deps.settings, DEFAULT_SETTINGS);
  }

  getSettings(): AudioAlertSettings {
    return this.settings;
  }

  async loadSettings(): Promise<AudioAlertSettings> {
    if (this.store === undefined) return this.settings;
    const stored = await this.store.get<AudioAlertSettingsPatch>(
      this.namespace,
      AUDIO_SETTINGS_KEY,
    );
    this.settings = normalizeSettingsPatch(stored, this.settings);
    return this.settings;
  }

  async updateSettings(patch: AudioAlertSettingsPatch): Promise<AudioAlertSettings> {
    this.settings = normalizeSettingsPatch(patch, this.settings);
    await this.persistSettings();
    return this.settings;
  }

  async setGlobalMute(muted: boolean): Promise<AudioAlertSettings> {
    return this.updateSettings({ globalMute: muted });
  }

  async setCategoryMuted(
    category: AudioAlertCategory,
    muted: boolean,
  ): Promise<AudioAlertSettings> {
    return this.updateSettings({ mutedCategories: { [category]: muted } });
  }

  async processVehicleState(
    next: VehicleState,
    options: Readonly<{ statusText?: StatusTextAlertInput | readonly StatusTextAlertInput[] }> = {},
  ): Promise<AudioAlertServiceResult> {
    const key = vehicleMapKey(next);
    const prev = this.previous.get(key);
    const detected = detectAlerts(prev, next, {
      nowMs: this.now(),
      lastFiredMs: this.lastFired,
      rateLimitsMs: this.settings.rateLimitsMs,
      thresholds: this.settings.thresholds,
      ...(options.statusText !== undefined ? { statusText: options.statusText } : {}),
    });
    this.previous.set(key, next);
    return this.fireDetected(detected);
  }

  async processStatusText(
    event: StatusTextAlertInput,
    vehicle?: VehicleState,
  ): Promise<AudioAlertServiceResult> {
    const detected = detectStatusTextAlerts(event, vehicle, {
      nowMs: this.now(),
      lastFiredMs: this.lastFired,
      rateLimitsMs: this.settings.rateLimitsMs,
      thresholds: this.settings.thresholds,
    });
    return this.fireDetected(detected);
  }

  reset(): void {
    this.previous.clear();
    this.lastFired.clear();
  }

  private async persistSettings(): Promise<void> {
    await this.store?.set<AudioAlertSettingsPatch>(
      this.namespace,
      AUDIO_SETTINGS_KEY,
      this.settings,
    );
  }

  private async fireDetected(detected: readonly AudioAlert[]): Promise<AudioAlertServiceResult> {
    if (detected.length === 0) return emptyResult(detected);
    if (!this.settings.enabled || this.settings.globalMute) return emptyResult(detected);

    const fired: AudioAlert[] = [];
    for (const alert of detected) {
      if (this.settings.mutedCategories[alert.category] === true) continue;
      fired.push(alert);
      this.lastFired.set(alert.key, alert.tMs);
      if (this.settings.voiceEnabled) {
        await this.speak(speechText(alert, this.translate), {
          volume: this.settings.volume,
          ...(this.settings.speechLang !== undefined ? { lang: this.settings.speechLang } : {}),
        });
      }
      if (this.settings.tonesEnabled) {
        await this.tone(alert, { volume: this.settings.volume });
      }
    }
    return Object.freeze({ fired: Object.freeze(fired), detected });
  }
}

/** Create the default voice/audio alert service. */
export function createAudioAlertService(deps: AudioAlertServiceDeps = {}): AudioAlertService {
  return new DefaultAudioAlertService(deps);
}
