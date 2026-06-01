/**
 * Web Bluetooth GATT {@link Transport} (T8.3; spec plan/03 §3.5 item 2).
 *
 * Targets serial-over-BLE telemetry bridges (UART-style service): `open()` asks
 * the user for a BLE device, connects GATT, resolves the configured service,
 * subscribes the RX notify characteristic into a stable readable byte stream,
 * and writes outbound bytes to the TX characteristic in ATT-sized chunks.
 *
 * Web Bluetooth does not expose the negotiated MTU in the browser API, so the
 * transport defaults to the conservative 20-byte ATT payload and accepts an
 * optional `mtu` config override for bridges/apps that know the negotiated size.
 */

import type { ConnState, LinkStats, Transport } from '../../contracts';
import {
  DEFAULT_BLE_MTU,
  type BluetoothDeviceFilterLike,
  type BluetoothDeviceLike,
  type BluetoothProviderLike,
  type BluetoothRemoteGATTCharacteristicLike,
  type BluetoothRemoteGATTServerLike,
  type BluetoothRequestDeviceOptionsLike,
  type BluetoothTransportConfig,
  type BluetoothUuidLike,
} from './types';

/** Injectable dependencies for {@link BluetoothTransport}. */
export interface BluetoothTransportDeps {
  /** Web Bluetooth provider; defaults to `navigator.bluetooth` at runtime. */
  bluetooth?: BluetoothProviderLike | undefined;
  /** Port-acquisition hook; defaults to `bluetooth.requestDevice(options)`. */
  requestDevice?:
    | ((
        bluetooth: BluetoothProviderLike,
        options: BluetoothRequestDeviceOptionsLike,
      ) => Promise<BluetoothDeviceLike>)
    | undefined;
}

/** Mutable counters backing {@link BluetoothTransport.stats}. */
interface MutableStats {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
}

/** Web Bluetooth GATT transport implementing the frozen {@link Transport} seam. */
export class BluetoothTransport implements Transport {
  readonly id = 'bluetooth';
  /** Browser BLE links do not expose enough re-plug state for in-transport retry. */
  readonly capabilities = { duplex: true, reconnect: false } as const;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  readonly #provider: BluetoothProviderLike | undefined;
  readonly #requestDevice: (
    bluetooth: BluetoothProviderLike,
    options: BluetoothRequestDeviceOptionsLike,
  ) => Promise<BluetoothDeviceLike>;
  readonly #listeners = new Set<(s: ConnState) => void>();
  readonly #stats: MutableStats = { bytesIn: 0, bytesOut: 0, packetsIn: 0 };

  #state: ConnState = { kind: 'closed' };
  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readableClosed = false;
  #device: BluetoothDeviceLike | null = null;
  #server: BluetoothRemoteGATTServerLike | null = null;
  #rxChar: BluetoothRemoteGATTCharacteristicLike | null = null;
  #txChar: BluetoothRemoteGATTCharacteristicLike | null = null;
  #mtu = DEFAULT_BLE_MTU;

  constructor(deps: BluetoothTransportDeps = {}) {
    this.#provider = deps.bluetooth;
    this.#requestDevice =
      deps.requestDevice ?? ((bluetooth, options) => bluetooth.requestDevice(options));

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readableController = controller;
      },
      cancel: () => {
        this.#readableClosed = true;
        void this.close();
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await this.#writeChunked(chunk);
      },
      abort: () => {
        void this.close();
      },
    });
  }

  /**
   * Prompt for a BLE device, connect GATT, resolve UART characteristics, and
   * subscribe the notify characteristic into {@link readable}.
   */
  async open(config: unknown): Promise<void> {
    if (this.#device !== null || this.#state.kind === 'opening' || this.#state.kind === 'open') {
      throw new Error('bluetooth transport: already open');
    }

    const cfg = parseConfig(config);
    const provider = this.#provider ?? defaultProvider();
    if (!provider) {
      const message = 'Web Bluetooth is not supported in this environment';
      this.#setState({ kind: 'error', message });
      throw new Error(message);
    }

    this.#setState({ kind: 'opening' });
    let device: BluetoothDeviceLike | null = null;
    let server: BluetoothRemoteGATTServerLike | null = null;
    let rxChar: BluetoothRemoteGATTCharacteristicLike | null = null;

    try {
      device = await this.#requestDevice(provider, requestOptionsFor(cfg));
      const gatt = device.gatt;
      if (!gatt) {
        throw new Error('bluetooth transport: selected device does not expose a GATT server');
      }

      server = await gatt.connect();
      const service = await server.getPrimaryService(cfg.serviceUuid);
      rxChar = await service.getCharacteristic(cfg.rxCharUuid);
      const txChar = await service.getCharacteristic(cfg.txCharUuid);
      const notifiedRxChar = await rxChar.startNotifications();

      device.addEventListener?.('gattserverdisconnected', this.#handleGattDisconnect);
      notifiedRxChar.addEventListener('characteristicvaluechanged', this.#handleNotification);

      this.#device = device;
      this.#server = server;
      this.#rxChar = notifiedRxChar;
      this.#txChar = txChar;
      this.#mtu = cfg.mtu ?? DEFAULT_BLE_MTU;
      this.#setState({ kind: 'open' });
    } catch (err) {
      rxChar?.removeEventListener('characteristicvaluechanged', this.#handleNotification);
      device?.removeEventListener?.('gattserverdisconnected', this.#handleGattDisconnect);
      server?.disconnect();
      this.#resetConnection();
      const message = errorMessage(err);
      this.#setState({ kind: 'error', message });
      throw err instanceof Error ? err : new Error(message);
    }
  }

  /** Stop notifications, disconnect GATT, and report `closed`. */
  async close(): Promise<void> {
    const rxChar = this.#rxChar;
    const device = this.#device;
    const server = this.#server;

    if (device === null && server === null && rxChar === null) {
      if (this.#state.kind !== 'closed') this.#setState({ kind: 'closed' });
      return;
    }

    device?.removeEventListener?.('gattserverdisconnected', this.#handleGattDisconnect);
    rxChar?.removeEventListener('characteristicvaluechanged', this.#handleNotification);
    if (rxChar?.stopNotifications) {
      try {
        await rxChar.stopNotifications();
      } catch {
        // A device may already be gone; close should still complete cleanly.
      }
    }
    server?.disconnect();
    this.#resetConnection();
    this.#setState({ kind: 'closed' });
  }

  /** Subscribe to state changes; the current state is delivered immediately. */
  onState(cb: (s: ConnState) => void): () => void {
    this.#listeners.add(cb);
    cb(this.#state);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  /** Link counters. Framing/loss/signing remain the MAVLink codec's concern. */
  stats(): LinkStats {
    return {
      bytesIn: this.#stats.bytesIn,
      bytesOut: this.#stats.bytesOut,
      packetsIn: this.#stats.packetsIn,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    };
  }

  /** Enqueue one RX notification as bytes. */
  readonly #handleNotification: EventListener = (event): void => {
    if (this.#readableClosed) return;
    const value = notificationValue(event);
    if (value === undefined) return;
    const bytes = bytesFromDataView(value);
    this.#stats.bytesIn += bytes.byteLength;
    this.#stats.packetsIn += 1;
    this.#readableController?.enqueue(bytes);
  };

  /** Surface unexpected BLE drops as an error state. */
  readonly #handleGattDisconnect = (): void => {
    if (this.#device === null) return;
    this.#rxChar?.removeEventListener('characteristicvaluechanged', this.#handleNotification);
    this.#device.removeEventListener?.('gattserverdisconnected', this.#handleGattDisconnect);
    this.#resetConnection();
    this.#setState({ kind: 'error', message: 'bluetooth device disconnected' });
  };

  /** Write one outbound chunk, split into ATT-sized BLE writes. */
  async #writeChunked(chunk: Uint8Array): Promise<void> {
    const txChar = this.#txChar;
    if (txChar === null || this.#state.kind !== 'open') {
      return;
    }

    try {
      for (let offset = 0; offset < chunk.byteLength; offset += this.#mtu) {
        const end = Math.min(offset + this.#mtu, chunk.byteLength);
        await writeCharacteristic(txChar, chunk.subarray(offset, end));
      }
      this.#stats.bytesOut += chunk.byteLength;
    } catch (err) {
      const message = errorMessage(err);
      this.#setState({ kind: 'error', message });
      throw err instanceof Error ? err : new Error(message);
    }
  }

  /** Drop per-connection state so the instance can be opened again. */
  #resetConnection(): void {
    this.#device = null;
    this.#server = null;
    this.#rxChar = null;
    this.#txChar = null;
    this.#mtu = DEFAULT_BLE_MTU;
  }

  /** Record and broadcast a new connection state. */
  #setState(s: ConnState): void {
    this.#state = s;
    for (const cb of this.#listeners) {
      cb(s);
    }
  }
}

/** Resolve and validate the opaque `open` config. */
function parseConfig(config: unknown): BluetoothTransportConfig {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError('bluetooth transport: config must be an object');
  }
  const raw = config as {
    serviceUuid?: unknown;
    rxCharUuid?: unknown;
    txCharUuid?: unknown;
    deviceFilters?: unknown;
    mtu?: unknown;
  };
  const serviceUuid = parseUuid(raw.serviceUuid, 'serviceUuid');
  const rxCharUuid = parseUuid(raw.rxCharUuid, 'rxCharUuid');
  const txCharUuid = parseUuid(raw.txCharUuid, 'txCharUuid');
  const mtu = parseMtu(raw.mtu);
  const deviceFilters = parseDeviceFilters(raw.deviceFilters);

  return {
    serviceUuid,
    rxCharUuid,
    txCharUuid,
    ...(deviceFilters !== undefined ? { deviceFilters } : {}),
    ...(mtu !== undefined ? { mtu } : {}),
  };
}

/** Validate a Web Bluetooth UUID-like config value. */
function parseUuid(value: unknown, key: string): BluetoothUuidLike {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new TypeError(`bluetooth transport: config.${key} must be a UUID string or number`);
}

/** Validate the optional BLE ATT payload size override. */
function parseMtu(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError('bluetooth transport: config.mtu must be a positive integer');
  }
  return value;
}

/** Validate optional requestDevice filters. */
function parseDeviceFilters(value: unknown): readonly BluetoothDeviceFilterLike[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('bluetooth transport: config.deviceFilters must be a non-empty array');
  }
  return value.map((filter) => {
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
      throw new TypeError('bluetooth transport: every device filter must be an object');
    }
    return { ...(filter as Record<string, unknown>) };
  });
}

/** Build the chooser options from a validated config. */
function requestOptionsFor(config: BluetoothTransportConfig): BluetoothRequestDeviceOptionsLike {
  const optionalServices = [config.serviceUuid];
  if (config.deviceFilters !== undefined) {
    return { filters: config.deviceFilters, optionalServices };
  }
  return { acceptAllDevices: true, optionalServices };
}

/** Read `navigator.bluetooth` defensively. */
function defaultProvider(): BluetoothProviderLike | undefined {
  const nav = (globalThis as { navigator?: { bluetooth?: unknown } }).navigator;
  const bluetooth = nav?.bluetooth;
  if (bluetooth && typeof (bluetooth as { requestDevice?: unknown }).requestDevice === 'function') {
    return bluetooth as BluetoothProviderLike;
  }
  return undefined;
}

/** Extract the DataView carried by a characteristic notification event. */
function notificationValue(event: Event): DataView | undefined {
  const target = event.target;
  if (typeof target !== 'object' || target === null) return undefined;
  const value = (target as { value?: unknown }).value;
  return value instanceof DataView ? value : undefined;
}

/** Copy a DataView into an owned Uint8Array before enqueueing it. */
function bytesFromDataView(view: DataView): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return bytes;
}

/** Write one ATT-sized payload using the best available Web Bluetooth method. */
async function writeCharacteristic(
  characteristic: BluetoothRemoteGATTCharacteristicLike,
  payload: Uint8Array,
): Promise<void> {
  // Web Bluetooth write methods require an ArrayBuffer-backed BufferSource; copy
  // the chunk into a fresh ArrayBuffer-backed view (handles Uint8Array<ArrayBufferLike>).
  const buf = new Uint8Array(payload);
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(buf);
    return;
  }
  if (characteristic.writeValueWithResponse) {
    await characteristic.writeValueWithResponse(buf);
    return;
  }
  if (characteristic.writeValue) {
    await characteristic.writeValue(buf);
    return;
  }
  throw new Error('bluetooth transport: TX characteristic is not writable');
}

/** Best-effort human-readable message for an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
