/** ADS-B traffic i18n strings registered by importing the ADS-B layer module. */
import { registerMessages } from '../../../../../core/i18n';

/** The shipped English `adsb.*` strings. */
export const ADSB_MESSAGES: Readonly<Record<string, string>> = {
  'adsb.layer.label': 'ADS-B traffic',
  'adsb.callsign.unknown': 'Unknown aircraft',
  'adsb.detail.icao': 'ICAO: {value}',
  'adsb.detail.altitude': 'Altitude: {value}',
  'adsb.detail.heading': 'Heading: {value}',
  'adsb.detail.groundSpeed': 'Ground speed: {value}',
  'adsb.detail.lastSeen': 'Last seen: {value}',
  'adsb.detail.emitter': 'Emitter: {value}',
};

registerMessages(ADSB_MESSAGES);
