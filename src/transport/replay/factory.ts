/**
 * Replay transport factory (spec plan/03 §3.5 item 6).
 *
 * `isSupported()` is always true: replay needs no platform API, only tlog bytes.
 * `create()` returns a {@link ReplayTransport}, whose additive playback controls
 * are available on the returned instance for the playback UI (T6.6).
 */

import type { TransportFactory } from '../../contracts/transport';
import { ReplayTransport } from './replay-transport';

/** Form schema describing the replay `open()` config for the connection UI. */
const replayConfigSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'arraybuffer',
      title: 'tlog data',
      description: 'Recorded telemetry log (.tlog) bytes to replay.',
      required: true,
    },
    speed: {
      type: 'number',
      title: 'Playback speed',
      description: 'Speed multiplier (0.1×–32×).',
      default: 1,
      minimum: 0.1,
      maximum: 32,
    },
  },
} as const;

/** The `'replay'` transport factory. */
export const replayTransportFactory: TransportFactory = {
  id: 'replay',
  label: 'Replay (tlog)',
  isSupported: () => true,
  configSchema: replayConfigSchema,
  create: () => new ReplayTransport(),
};
