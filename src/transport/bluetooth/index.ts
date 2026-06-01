/**
 * `transport/bluetooth` public surface (T8.3; spec plan/03 §3.5 item 2). A Web
 * Bluetooth GATT {@link Transport} + {@link TransportFactory} (id
 * `"bluetooth"`) for serial-over-BLE telemetry bridges.
 */

export type { Transport, TransportFactory, ConnState, LinkStats } from '../../contracts';

export { BluetoothTransport, type BluetoothTransportDeps } from './bluetooth-transport';
export {
  createBluetoothTransportFactory,
  bluetoothTransportFactory,
  type BluetoothTransportFactoryDeps,
} from './factory';
export {
  BLUETOOTH_CONFIG_SCHEMA,
  type BluetoothConfigSchema,
  type BluetoothConfigField,
} from './config-schema';
export {
  DEFAULT_BLE_MTU,
  type BluetoothDeviceFilterLike,
  type BluetoothDeviceLike,
  type BluetoothProviderLike,
  type BluetoothRemoteGATTCharacteristicLike,
  type BluetoothRemoteGATTServerLike,
  type BluetoothRemoteGATTServiceLike,
  type BluetoothRequestDeviceOptionsLike,
  type BluetoothTransportConfig,
  type BluetoothUuidLike,
} from './types';
