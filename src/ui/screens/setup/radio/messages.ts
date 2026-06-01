/**
 * i18n registration for the Radio (RC) setup step (T5.6). All keys are under
 * `setup.radio.*` and are contributed through the public registerMessages seam.
 */
import { registerMessages } from '../../../../core/i18n';

/** English strings owned by the radio setup step. */
export const SETUP_RADIO_MESSAGES: Readonly<Record<string, string>> = {
  'setup.radio.title': 'Radio calibration',
  'setup.radio.safety':
    'Remove propellers before calibrating radio input. Move all sticks, knobs, and switches through their full travel, then return sticks to center before saving trims.',
  'setup.radio.intro':
    'Start capture, move every RC channel to both endpoints, then return controls to their resting center and save. MVPlanner writes RCn_MIN, RCn_MAX, and RCn_TRIM for each active channel.',
  'setup.radio.start': 'Start capture',
  'setup.radio.restart': 'Restart capture',
  'setup.radio.cancel': 'Cancel',
  'setup.radio.save': 'Save calibration',
  'setup.radio.status.idle': 'Ready to capture radio input.',
  'setup.radio.status.active': 'Capturing live RC input. Move every channel through its extremes.',
  'setup.radio.status.saving': 'Saving captured RC calibration parameters…',
  'setup.radio.status.done': 'Radio calibration parameters saved.',
  'setup.radio.status.warning': 'Radio calibration needs attention: {message}',
  'setup.radio.noChannels': 'No RC channels received yet.',
  'setup.radio.channels.title': 'Live RC channels',
  'setup.radio.channel.label': 'Channel {n}',
  'setup.radio.channel.current': 'Current {value}',
  'setup.radio.channel.range': 'Min {min} · Max {max} · Trim {trim}',
  'setup.radio.channel.saved': 'Vehicle cache: min {min} · max {max} · trim {trim}',
  'setup.radio.channel.savedMissing': 'Vehicle cache: no saved RC parameters available',
  'setup.radio.table.channel': 'Channel',
  'setup.radio.table.current': 'Current',
  'setup.radio.table.min': 'Min',
  'setup.radio.table.max': 'Max',
  'setup.radio.table.trim': 'Trim',
  'setup.radio.table.samples': 'Samples',
  'setup.radio.done': 'Saved',
  'setup.radio.todo': 'Not saved',
};

let registered = false;

/** Register radio setup English messages once (idempotent). */
export function registerRadioMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_RADIO_MESSAGES);
}

registerRadioMessages();
