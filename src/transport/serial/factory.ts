/**
 * Web Serial {@link TransportFactory} (T1.6; spec plan/03 §3.5 item 1; contract
 * `src/contracts/transport.ts`). Drives capability detection + the connection
 * UI form and constructs {@link SerialTransport} instances.
 */

import type { Transport, TransportFactory } from '../../contracts';
import { SERIAL_CONFIG_SCHEMA } from './config-schema';
import { SerialTransport, type SerialTransportDeps } from './serial-transport';

/** Options for {@link createSerialTransportFactory}. */
export interface SerialTransportFactoryDeps extends SerialTransportDeps {
  /**
   * Override capability detection. Defaults to `'serial' in navigator` (or
   * `true` when an explicit provider is injected). Lets tests force support on
   * or off without mutating globals.
   */
  isSupported?: (() => boolean) | undefined;
}

/**
 * Build a Serial {@link TransportFactory}. With no args it probes the ambient
 * `navigator.serial`; tests pass a fake `provider`/`requestPort` (and optionally
 * `isSupported`) for deterministic behavior.
 */
export function createSerialTransportFactory(
  deps: SerialTransportFactoryDeps = {},
): TransportFactory {
  const { isSupported, provider, requestPort } = deps;
  const transportDeps: SerialTransportDeps = { provider, requestPort };
  const supported = isSupported ?? (provider ? (): boolean => true : serialInNavigator);
  return {
    id: 'serial',
    label: 'Serial',
    isSupported: supported,
    configSchema: SERIAL_CONFIG_SCHEMA,
    create: (): Transport => new SerialTransport(transportDeps),
  };
}

/** Default factory probing the real `navigator.serial` at call time. */
export const serialTransportFactory: TransportFactory = createSerialTransportFactory();

/** Capability check per the task spec: `'serial' in navigator`. */
function serialInNavigator(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return typeof nav === 'object' && nav !== null && 'serial' in nav;
}
