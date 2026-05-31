/**
 * `transport/serial` public surface (T1.6; spec plan/03 §3.5 item 1). A Web
 * Serial {@link Transport} + {@link TransportFactory} (id `"serial"`) over the
 * frozen `src/contracts/transport.ts` seam. Cross-module consumers import from
 * here, never deep paths (conventions plan/implementation/00 §0.3).
 */

export type { Transport, TransportFactory, ConnState, LinkStats } from '../../contracts';

export { SerialTransport, type SerialTransportDeps } from './serial-transport';
export {
  createSerialTransportFactory,
  serialTransportFactory,
  type SerialTransportFactoryDeps,
} from './factory';
export {
  SERIAL_CONFIG_SCHEMA,
  type SerialConfigSchema,
  type SerialConfigField,
  type SerialConfigOption,
} from './config-schema';
export {
  DEFAULT_BAUD_RATE,
  SUPPORTED_BAUD_RATES,
  type SerialTransportConfig,
  type SerialPortLike,
  type SerialProviderLike,
  type SerialPortOpenOptions,
  type SerialPortRequestOptions,
} from './types';
