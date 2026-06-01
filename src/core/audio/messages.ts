/**
 * Audio-alert i18n strings (task T8.7).
 *
 * Owned `audio.*` keys are contributed via the public `registerMessages` seam;
 * this module does not edit i18n internals or the central catalog.
 */
import { registerMessages } from '../i18n';

/** English voice/audio alert strings. */
export const AUDIO_MESSAGES: Readonly<Record<string, string>> = {
  'audio.alert.modeChange': 'Mode changed to {mode}',
  'audio.alert.armed': 'Vehicle armed',
  'audio.alert.disarmed': 'Vehicle disarmed',
  'audio.alert.failsafe': 'Failsafe',
  'audio.alert.failsafeRc': 'RC failsafe',
  'audio.alert.failsafeBattery': 'Battery failsafe',
  'audio.alert.failsafeGcs': 'GCS failsafe',
  'audio.alert.failsafeEkf': 'EKF or GPS failsafe',
  'audio.alert.batteryLow': 'Battery low: {pct}% remaining',
  'audio.alert.batteryCritical': 'Battery critical: {pct}% remaining',
  'audio.alert.batteryLowText': 'Battery low',
  'audio.alert.batteryCriticalText': 'Battery critical',
  'audio.alert.gpsLost': 'GPS fix lost',
  'audio.alert.ekfUnhealthy': 'EKF unhealthy',
  'audio.category.mode': 'Mode changes',
  'audio.category.arm': 'Arm / disarm',
  'audio.category.failsafe': 'Failsafes',
  'audio.category.battery': 'Battery',
  'audio.category.gps': 'GPS',
  'audio.category.ekf': 'EKF',
  'audio.setting.voice': 'Voice alerts',
  'audio.setting.tones': 'Tone alerts',
  'audio.setting.globalMute': 'Mute all audio alerts',
  'audio.setting.volume': 'Volume',
};

registerMessages(AUDIO_MESSAGES);
