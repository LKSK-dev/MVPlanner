/**
 * tlog playback i18n strings (task T6.6; conventions plan/implementation/00 §0.3,
 * spec plan/05 §5.9).
 *
 * The playback control bar + preset selector own the `logs.playback.*` namespace
 * and contribute it at IMPORT TIME via the public {@link registerMessages} seam —
 * never editing the central English catalog or the i18n internals. Importing this
 * module (the component and the barrel both do) makes `t('logs.playback.*')`
 * resolve. Registration is additive and idempotent.
 */
import { registerMessages } from '../../../../core/i18n';

/** The shipped English `logs.playback.*` strings. */
export const PLAYBACK_MESSAGES: Readonly<Record<string, string>> = {
  // --- control bar ---------------------------------------------------------
  'logs.playback.region': 'Tlog playback',
  'logs.playback.transport': 'Playback transport',
  'logs.playback.play': 'Play',
  'logs.playback.pause': 'Pause',
  'logs.playback.step': 'Step one frame',
  'logs.playback.seek': 'Seek playback position',
  'logs.playback.speed': 'Playback speed',
  'logs.playback.speedValue': '{n}\u00d7',
  'logs.playback.time': 'Playback time',
  'logs.playback.timeReadout': '{current} / {total}',

  // --- preset analyses (spec plan/04 §4.8) ---------------------------------
  'logs.playback.preset': 'Preset analysis',
  'logs.playback.preset.none': 'None',
  'logs.playback.preset.vibration': 'Vibration',
  'logs.playback.preset.vibration.desc': 'IMU vibration levels and clipping events.',
  'logs.playback.preset.ekf': 'EKF',
  'logs.playback.preset.ekf.desc': 'EKF state estimator variances.',
  'logs.playback.preset.battery': 'Battery',
  'logs.playback.preset.battery.desc': 'Pack voltage, current draw, and remaining capacity.',
  'logs.playback.preset.gps': 'GPS',
  'logs.playback.preset.gps.desc': 'Satellite count, fix type, and dilution of precision.',
  'logs.playback.preset.pid': 'PID setpoint vs actual',
  'logs.playback.preset.pid.desc': 'Desired versus achieved values from PID tuning.',

  // --- preset series labels (consumed by the plotter) ----------------------
  'logs.playback.series.vibe.xyz': 'Vibration X/Y/Z',
  'logs.playback.series.vibe.clip': 'Clipping events',
  'logs.playback.series.ekf.variances': 'EKF variances',
  'logs.playback.series.battery.voltage': 'Voltage',
  'logs.playback.series.battery.current': 'Current',
  'logs.playback.series.battery.remaining': 'Remaining %',
  'logs.playback.series.gps.sats': 'Satellites visible',
  'logs.playback.series.gps.dop': 'HDOP / VDOP',
  'logs.playback.series.gps.fix': 'Fix type',
  'logs.playback.series.pid.desired': 'Setpoint (desired)',
  'logs.playback.series.pid.achieved': 'Actual (achieved)',
};

registerMessages(PLAYBACK_MESSAGES);
