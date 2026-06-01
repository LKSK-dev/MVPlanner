/**
 * Structural Web Bluetooth types + BLE transport config (T8.3; spec plan/03
 * §3.5 item 2; contract `src/contracts/transport.ts`).
 *
 * The DOM Web Bluetooth surface is intentionally represented structurally here
 * so unit tests can inject fake GATT devices/characteristics without requiring a
 * browser prompt. Only the members consumed by the transport are modeled.
 */

/** UUID values accepted by Web Bluetooth methods (canonical string or alias id). */
export type BluetoothUuidLike = string | number;

/** Opaque device filter forwarded to `Bluetooth.requestDevice`. */
export type BluetoothDeviceFilterLike = Readonly<Record<string, unknown>>;

/** Options sent to `Bluetooth.requestDevice`. */
export interface BluetoothRequestDeviceOptionsLike {
  /** User-specified filters; absent when the transport uses `acceptAllDevices`. */
  readonly filters?: readonly BluetoothDeviceFilterLike[];
  /** Broad chooser mode used when the config does not provide filters. */
  readonly acceptAllDevices?: boolean;
  /** Ensures the configured UART service is accessible after selection. */
  readonly optionalServices?: readonly BluetoothUuidLike[];
}

/** Minimal view of `navigator.bluetooth`. */
export interface BluetoothProviderLike {
  /** Prompt the user to select a BLE device. */
  requestDevice(options: BluetoothRequestDeviceOptionsLike): Promise<BluetoothDeviceLike>;
}

/** Minimal Web Bluetooth `BluetoothDevice` view. */
export interface BluetoothDeviceLike {
  /** Device GATT server; browsers expose this after selection for GATT devices. */
  readonly gatt?: BluetoothRemoteGATTServerLike | null;
  /** Subscribe to an unexpected BLE disconnection, when modeled by the runtime. */
  addEventListener?(type: 'gattserverdisconnected', listener: () => void): void;
  /** Remove a previously registered disconnection listener. */
  removeEventListener?(type: 'gattserverdisconnected', listener: () => void): void;
}

/** Minimal Web Bluetooth `BluetoothRemoteGATTServer` view. */
export interface BluetoothRemoteGATTServerLike {
  /** Current connection state, when exposed by the runtime/fake. */
  readonly connected?: boolean;
  /** Connect and return the active server. */
  connect(): Promise<BluetoothRemoteGATTServerLike>;
  /** Disconnect the active GATT session. */
  disconnect(): void;
  /** Resolve the configured UART service. */
  getPrimaryService(service: BluetoothUuidLike): Promise<BluetoothRemoteGATTServiceLike>;
}

/** Minimal Web Bluetooth `BluetoothRemoteGATTService` view. */
export interface BluetoothRemoteGATTServiceLike {
  /** Resolve a characteristic from the configured service. */
  getCharacteristic(uuid: BluetoothUuidLike): Promise<BluetoothRemoteGATTCharacteristicLike>;
}

/** Minimal Web Bluetooth `BluetoothRemoteGATTCharacteristic` view. */
export interface BluetoothRemoteGATTCharacteristicLike {
  /** Last notification value; populated before `characteristicvaluechanged`. */
  readonly value?: DataView | null;
  /** Enable notifications/indications for inbound bytes. */
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristicLike>;
  /** Disable notifications, when supported. */
  stopNotifications?(): Promise<BluetoothRemoteGATTCharacteristicLike>;
  /** Preferred write path for UART TX characteristics that support it. */
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  /** Fallback write path for characteristics requiring response writes. */
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  /** Legacy Web Bluetooth write path retained by older Chromium versions. */
  writeValue?(value: BufferSource): Promise<void>;
  /** Subscribe to inbound notifications. */
  addEventListener(type: 'characteristicvaluechanged', listener: EventListener): void;
  /** Remove an inbound notification listener. */
  removeEventListener(type: 'characteristicvaluechanged', listener: EventListener): void;
}

/** Config object accepted by `BluetoothTransport.open` (contract `open(config)`). */
export interface BluetoothTransportConfig {
  /** Optional chooser filters forwarded to `requestDevice`. */
  readonly deviceFilters?: readonly BluetoothDeviceFilterLike[];
  /** GATT service UUID for the serial-over-BLE/UART bridge. */
  readonly serviceUuid: BluetoothUuidLike;
  /** Notify characteristic UUID (vehicle → browser bytes). */
  readonly rxCharUuid: BluetoothUuidLike;
  /** Write characteristic UUID (browser → vehicle bytes). */
  readonly txCharUuid: BluetoothUuidLike;
  /** ATT payload size for outbound chunking; defaults to 20 bytes. */
  readonly mtu?: number;
}

/** Conservative BLE ATT payload size when negotiated MTU is not exposed. */
export const DEFAULT_BLE_MTU = 20;
