/**
 * Web Bluetooth {@link TransportFactory} (T8.3; spec plan/03 §3.5 item 2).
 * Drives capability detection + the connection UI form and constructs
 * {@link BluetoothTransport} instances.
 */

import type { Transport, TransportFactory } from '../../contracts';
import { BLUETOOTH_CONFIG_SCHEMA } from './config-schema';
import { BluetoothTransport, type BluetoothTransportDeps } from './bluetooth-transport';

/** Options for {@link createBluetoothTransportFactory}. */
export interface BluetoothTransportFactoryDeps extends BluetoothTransportDeps {
  /**
   * Override capability detection. Defaults to `'bluetooth' in navigator` (or
   * `true` when an explicit provider is injected) so tests can avoid mutating
   * globals while still exercising factory-created transports.
   */
  isSupported?: (() => boolean) | undefined;
}

/**
 * Build a Bluetooth {@link TransportFactory}. Production uses the ambient
 * `navigator.bluetooth`; tests can pass a fake provider and/or support probe.
 */
export function createBluetoothTransportFactory(
  deps: BluetoothTransportFactoryDeps = {},
): TransportFactory {
  const { isSupported, bluetooth, requestDevice } = deps;
  const transportDeps: BluetoothTransportDeps = { bluetooth, requestDevice };
  const supported = isSupported ?? (bluetooth ? (): boolean => true : bluetoothInNavigator);
  return {
    id: 'bluetooth',
    label: 'Bluetooth',
    isSupported: supported,
    configSchema: BLUETOOTH_CONFIG_SCHEMA,
    create: (): Transport => new BluetoothTransport(transportDeps),
  };
}

/** Default factory probing the real `navigator.bluetooth` at call time. */
export const bluetoothTransportFactory: TransportFactory = createBluetoothTransportFactory();

/** Capability check per the task spec: `'bluetooth' in navigator`. */
function bluetoothInNavigator(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return typeof nav === 'object' && nav !== null && 'bluetooth' in nav;
}
