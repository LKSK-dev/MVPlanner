/** Public surface for T8.7 voice/audio alerts. */
export {
  DEFAULT_AUDIO_RATE_LIMIT_MS,
  DEFAULT_AUDIO_THRESHOLDS,
  detectAlerts,
  detectStatusTextAlerts,
} from './detect';
export { AUDIO_MESSAGES } from './messages';
export {
  AUDIO_SETTINGS_KEY,
  AUDIO_SETTINGS_NAMESPACE,
  DefaultAudioAlertService,
  createAudioAlertService,
} from './service';
export { createDefaultTone, defaultSpeak } from './tone';
export type {
  AudioAlert,
  AudioAlertCategory,
  AudioAlertKind,
  AudioAlertService,
  AudioAlertServiceDeps,
  AudioAlertServiceResult,
  AudioAlertSettings,
  AudioAlertSettingsPatch,
  AudioClock,
  AudioDetectionThresholds,
  AudioLastFired,
  AudioRateLimits,
  AudioSpeak,
  AudioTone,
  AudioTonePattern,
  DetectAlertsOptions,
  StatusTextAlertInput,
} from './types';
