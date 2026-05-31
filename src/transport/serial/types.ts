/**
 * Structural Web Serial types + Serial transport config (T1.6; spec plan/03
 * §3.5 item 1; contract `src/contracts/transport.ts`).
 *
 * The Web Serial API (`navigator.serial`, `SerialPort`) is not part of the TS
 * DOM lib shipped with this project (`tsconfig` uses `types: []` and no
 * `@types/w3c-web-serial`), and we must not assume more than we use. These
 * minimal structural views describe exactly the slice the transport relies on,
 * which also lets unit tests inject a fake `SerialPort` with stub
 * `ReadableStream`/`WritableStream` (conventions plan/implementation/00 §0.3).
 */

/** Options accepted by {@link SerialPortLike.open} — the subset we use. */
export interface SerialPortOpenOptions {
  /** Connection baud rate (e.g. 57600 / 115200 / 921600). */
  readonly baudRate: number;
}

/**
 * Minimal structural view of a Web Serial `SerialPort`. `readable`/`writable`
 * are `null` until {@link SerialPortLike.open} resolves, then expose the port's
 * byte streams. The `disconnect` event (re-plug detection) is optional because
 * not every environment — notably the unit-test fakes — needs to model it.
 */
export interface SerialPortLike {
  /** Inbound byte stream; `null` until opened. */
  readonly readable: ReadableStream<Uint8Array> | null;
  /** Outbound byte stream; `null` until opened. */
  readonly writable: WritableStream<Uint8Array> | null;
  /** Open the underlying port with the given options. */
  open(options: SerialPortOpenOptions): Promise<void>;
  /** Release the port and its streams. */
  close(): Promise<void>;
  /** Subscribe to the `disconnect` (re-plug/unplug) event, when supported. */
  addEventListener?(type: 'disconnect', listener: () => void): void;
  /** Remove a previously-added `disconnect` listener, when supported. */
  removeEventListener?(type: 'disconnect', listener: () => void): void;
}

/** Opaque filter set forwarded to {@link SerialProviderLike.requestPort}. */
export type SerialPortRequestOptions = Record<string, unknown>;

/**
 * Minimal structural view of `navigator.serial`. Injectable so tests can supply
 * a fake that returns a fake {@link SerialPortLike} from `requestPort`.
 */
export interface SerialProviderLike {
  /** Prompt the user to pick a port (must follow a user gesture in browsers). */
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPortLike>;
  /** Previously-granted ports, when the provider supports enumeration. */
  getPorts?(): Promise<SerialPortLike[]>;
}

/** Config object accepted by `SerialTransport.open` (contract `open(config)`). */
export interface SerialTransportConfig {
  /** Baud rate; defaults to {@link DEFAULT_BAUD_RATE} when omitted. */
  readonly baudRate?: number;
}

/** Default baud rate when the config omits one (spec plan/03 §3.5 item 1). */
export const DEFAULT_BAUD_RATE = 115_200;

/**
 * Common baud rates surfaced by the connection UI (spec plan/03 §3.5 item 1:
 * "57600/115200/921600…"). `open` still accepts any positive integer baud — the
 * spec list is open-ended — this set only drives the config-schema dropdown.
 */
export const SUPPORTED_BAUD_RATES: readonly number[] = [57_600, 115_200, 921_600];
