/**
 * Connection-UI descriptor for the Web Bluetooth transport (T8.3; spec plan/03
 * §3.5 item 2). The frozen `TransportFactory.configSchema` seam is `unknown`,
 * so this JSON-ish descriptor is intentionally self-contained.
 */

import { DEFAULT_BLE_MTU } from './types';

/** One form control in {@link BluetoothConfigSchema}. */
export interface BluetoothConfigField {
  readonly key: string;
  readonly type: 'text' | 'number' | 'json';
  readonly label: string;
  readonly required?: boolean;
  readonly default?: string | number;
  readonly description?: string;
}

/** The Bluetooth transport's connection-form descriptor. */
export interface BluetoothConfigSchema {
  readonly id: 'bluetooth';
  readonly fields: readonly BluetoothConfigField[];
}

/** Frozen config-schema instance exposed by the factory. */
export const BLUETOOTH_CONFIG_SCHEMA: BluetoothConfigSchema = {
  id: 'bluetooth',
  fields: [
    {
      key: 'serviceUuid',
      type: 'text',
      label: 'transport.bluetooth.serviceUuid',
      required: true,
      description: 'BLE UART/serial service UUID exposed by the telemetry bridge.',
    },
    {
      key: 'rxCharUuid',
      type: 'text',
      label: 'transport.bluetooth.rxCharUuid',
      required: true,
      description: 'Notify characteristic UUID for vehicle-to-browser bytes.',
    },
    {
      key: 'txCharUuid',
      type: 'text',
      label: 'transport.bluetooth.txCharUuid',
      required: true,
      description: 'Write characteristic UUID for browser-to-vehicle bytes.',
    },
    {
      key: 'mtu',
      type: 'number',
      label: 'transport.bluetooth.mtu',
      default: DEFAULT_BLE_MTU,
      description: 'Outbound write chunk size; Web Bluetooth does not expose negotiated MTU.',
    },
    {
      key: 'deviceFilters',
      type: 'json',
      label: 'transport.bluetooth.deviceFilters',
      description: 'Optional Web Bluetooth requestDevice filters array.',
    },
  ],
};
