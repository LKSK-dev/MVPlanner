import { afterEach, describe, expect, it } from 'vitest';
import {
  BLUETOOTH_CONFIG_SCHEMA,
  BluetoothTransport,
  bluetoothTransportFactory,
  createBluetoothTransportFactory,
  type BluetoothDeviceLike,
  type BluetoothProviderLike,
  type BluetoothRemoteGATTCharacteristicLike,
  type BluetoothRemoteGATTServerLike,
  type BluetoothRemoteGATTServiceLike,
  type BluetoothRequestDeviceOptionsLike,
} from '../../src/transport/bluetooth';
import type { ConnState } from '../../src/contracts';

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const RX_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const TX_UUID = '0000ffe2-0000-1000-8000-00805f9b34fb';

/** Copy a Web Bluetooth write payload so assertions do not depend on view reuse. */
function copyBufferSource(data: BufferSource): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return copy;
}

/** Fake GATT characteristic backed by EventTarget notifications and write capture. */
class FakeCharacteristic extends EventTarget implements BluetoothRemoteGATTCharacteristicLike {
  value: DataView | null = null;
  notificationsStarted = false;
  notificationsStopped = false;
  readonly written: Uint8Array<ArrayBuffer>[] = [];

  async startNotifications(): Promise<BluetoothRemoteGATTCharacteristicLike> {
    this.notificationsStarted = true;
    return this;
  }

  async stopNotifications(): Promise<BluetoothRemoteGATTCharacteristicLike> {
    this.notificationsStopped = true;
    return this;
  }

  async writeValueWithoutResponse(value: BufferSource): Promise<void> {
    this.written.push(copyBufferSource(value));
  }

  /** Test helper: dispatch one notify event carrying the given bytes. */
  notify(bytes: Uint8Array<ArrayBuffer>): void {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.value = new DataView(buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

/** Fake GATT service that returns configured characteristics by UUID. */
class FakeService implements BluetoothRemoteGATTServiceLike {
  requestedCharacteristics: Array<string | number> = [];

  constructor(
    readonly rx: FakeCharacteristic,
    readonly tx: FakeCharacteristic,
  ) {}

  async getCharacteristic(uuid: string | number): Promise<BluetoothRemoteGATTCharacteristicLike> {
    this.requestedCharacteristics.push(uuid);
    if (uuid === RX_UUID) return this.rx;
    if (uuid === TX_UUID) return this.tx;
    throw new Error(`unexpected characteristic ${String(uuid)}`);
  }
}

/** Fake GATT server that records connect/disconnect and service lookup. */
class FakeServer implements BluetoothRemoteGATTServerLike {
  connected = false;
  disconnected = false;
  requestedServices: Array<string | number> = [];

  constructor(readonly service: FakeService) {}

  async connect(): Promise<BluetoothRemoteGATTServerLike> {
    this.connected = true;
    return this;
  }

  disconnect(): void {
    this.connected = false;
    this.disconnected = true;
  }

  async getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTServiceLike> {
    this.requestedServices.push(service);
    return this.service;
  }
}

/** Fake BluetoothDevice with a GATT disconnect event. */
class FakeDevice implements BluetoothDeviceLike {
  readonly listeners = new Set<() => void>();

  constructor(readonly gatt: BluetoothRemoteGATTServerLike) {}

  addEventListener(type: 'gattserverdisconnected', listener: () => void): void {
    if (type === 'gattserverdisconnected') this.listeners.add(listener);
  }

  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void {
    if (type === 'gattserverdisconnected') this.listeners.delete(listener);
  }

  emitDisconnect(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Fake navigator.bluetooth provider returning a single device. */
class FakeBluetoothProvider implements BluetoothProviderLike {
  lastOptions: BluetoothRequestDeviceOptionsLike | null = null;

  constructor(readonly device: FakeDevice) {}

  async requestDevice(options: BluetoothRequestDeviceOptionsLike): Promise<BluetoothDeviceLike> {
    this.lastOptions = options;
    return this.device;
  }
}

function makeFakes(): {
  rx: FakeCharacteristic;
  tx: FakeCharacteristic;
  service: FakeService;
  server: FakeServer;
  device: FakeDevice;
  provider: FakeBluetoothProvider;
} {
  const rx = new FakeCharacteristic();
  const tx = new FakeCharacteristic();
  const service = new FakeService(rx, tx);
  const server = new FakeServer(service);
  const device = new FakeDevice(server);
  const provider = new FakeBluetoothProvider(device);
  return { rx, tx, service, server, device, provider };
}

function config(extra?: { mtu?: number }): {
  serviceUuid: string;
  rxCharUuid: string;
  txCharUuid: string;
  mtu?: number;
} {
  return {
    serviceUuid: SERVICE_UUID,
    rxCharUuid: RX_UUID,
    txCharUuid: TX_UUID,
    ...(extra?.mtu !== undefined ? { mtu: extra.mtu } : {}),
  };
}

function collectStates(t: BluetoothTransport): ConnState[] {
  const states: ConnState[] = [];
  t.onState((s) => states.push(s));
  return states;
}

/** Poll until `pred` holds, or fail after ~100ms. */
async function until(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timeout waiting for ${label}`);
}

let restoreBluetooth: (() => void) | null = null;

afterEach(() => {
  restoreBluetooth?.();
  restoreBluetooth = null;
});

describe('BluetoothTransport lifecycle', () => {
  it('opens, connects GATT, resolves characteristics, and subscribes notifications', async () => {
    const { rx, service, server, provider } = makeFakes();
    const t = new BluetoothTransport({ bluetooth: provider });
    const states = collectStates(t);

    await t.open(config());

    expect(provider.lastOptions).toEqual({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });
    expect(server.connected).toBe(true);
    expect(server.requestedServices).toEqual([SERVICE_UUID]);
    expect(service.requestedCharacteristics).toEqual([RX_UUID, TX_UUID]);
    expect(rx.notificationsStarted).toBe(true);
    expect(states.map((s) => s.kind)).toEqual(['closed', 'opening', 'open']);
  });

  it('uses requestDevice filters when provided', async () => {
    const { provider } = makeFakes();
    const t = new BluetoothTransport({ bluetooth: provider });

    await t.open({ ...config(), deviceFilters: [{ namePrefix: 'UART' }] });

    expect(provider.lastOptions).toEqual({
      filters: [{ namePrefix: 'UART' }],
      optionalServices: [SERVICE_UUID],
    });
  });

  it('delivers the current state immediately on subscribe', () => {
    const t = new BluetoothTransport({ bluetooth: makeFakes().provider });
    const states = collectStates(t);
    expect(states).toEqual([{ kind: 'closed' }]);
  });

  it('advertises its id and duplex capability', () => {
    const t = new BluetoothTransport({ bluetooth: makeFakes().provider });
    expect(t.id).toBe('bluetooth');
    expect(t.capabilities).toEqual({ duplex: true, reconnect: false });
  });
});

describe('BluetoothTransport byte flow + stats', () => {
  it('surfaces an inbound characteristicvaluechanged DataView on readable', async () => {
    const { rx, provider } = makeFakes();
    const t = new BluetoothTransport({ bluetooth: provider });
    await t.open(config());

    const reader = t.readable.getReader();
    rx.notify(new Uint8Array([1, 2, 3, 4]));
    const first = await reader.read();

    expect(first.value).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(t.stats()).toEqual({
      bytesIn: 4,
      bytesOut: 0,
      packetsIn: 1,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    });

    reader.releaseLock();
    await t.close();
  });

  it('writes to the TX characteristic in configured MTU chunks', async () => {
    const { tx, provider } = makeFakes();
    const t = new BluetoothTransport({ bluetooth: provider });
    await t.open(config({ mtu: 3 }));

    const writer = t.writable.getWriter();
    await writer.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    await until(() => tx.written.length === 3, 'BLE writes');

    expect(tx.written).toEqual([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8]),
    ]);
    expect(t.stats().bytesOut).toBe(8);

    writer.releaseLock();
    await t.close();
  });
});

describe('BluetoothTransport close and errors', () => {
  it('close disconnects GATT, stops notifications, and sets closed', async () => {
    const { rx, server, provider } = makeFakes();
    const t = new BluetoothTransport({ bluetooth: provider });
    const states = collectStates(t);
    await t.open(config());

    await t.close();

    expect(rx.notificationsStopped).toBe(true);
    expect(server.disconnected).toBe(true);
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });
  });

  it('transitions to error on an unexpected GATT disconnect', async () => {
    const { device, provider } = makeFakes();
    const t = new BluetoothTransport({ bluetooth: provider });
    const states = collectStates(t);
    await t.open(config());

    device.emitDisconnect();

    expect(states[states.length - 1]).toEqual({
      kind: 'error',
      message: 'bluetooth device disconnected',
    });
  });

  it('errors when no Web Bluetooth provider is available', async () => {
    const t = new BluetoothTransport();
    const states = collectStates(t);

    await expect(t.open(config())).rejects.toThrow(/not supported/);
    expect(states[states.length - 1]).toEqual({
      kind: 'error',
      message: 'Web Bluetooth is not supported in this environment',
    });
  });
});

describe('bluetooth transport factory', () => {
  it('reports supported when a provider is injected', () => {
    const factory = createBluetoothTransportFactory({ bluetooth: makeFakes().provider });
    expect(factory.id).toBe('bluetooth');
    expect(factory.label).toBe('Bluetooth');
    expect(factory.isSupported()).toBe(true);
    expect(factory.configSchema).toBe(BLUETOOTH_CONFIG_SCHEMA);
  });

  it('creates working transports that open via the injected provider', async () => {
    const { provider, server } = makeFakes();
    const factory = createBluetoothTransportFactory({ bluetooth: provider });
    const transport = factory.create();

    await transport.open(config());

    expect(transport.id).toBe('bluetooth');
    expect(server.connected).toBe(true);
    await transport.close();
  });

  it('isSupported reflects bluetooth presence on navigator for the default factory', () => {
    const nav = globalThis.navigator as unknown as Record<string, unknown>;
    const original = Object.getOwnPropertyDescriptor(nav, 'bluetooth');
    restoreBluetooth = () => {
      if (original === undefined) {
        delete nav.bluetooth;
      } else {
        Object.defineProperty(nav, 'bluetooth', original);
      }
    };

    delete nav.bluetooth;
    expect(bluetoothTransportFactory.isSupported()).toBe(false);

    Object.defineProperty(nav, 'bluetooth', {
      configurable: true,
      value: makeFakes().provider,
    });
    expect(bluetoothTransportFactory.isSupported()).toBe(true);
  });

  it('honors an explicit isSupported override', () => {
    expect(createBluetoothTransportFactory({ isSupported: () => true }).isSupported()).toBe(true);
    expect(createBluetoothTransportFactory({ isSupported: () => false }).isSupported()).toBe(false);
  });
});
