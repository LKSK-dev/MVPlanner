/**
 * Transport seam (impl 02 §2.2; spec plan/03 §3.5). FROZEN.
 */

export type ConnState =
  | { kind: 'closed' }
  | { kind: 'opening' }
  | { kind: 'open' }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'error'; message: string };

export interface LinkStats {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  lossPct: number;
  rateHz: number;
  rssi?: number;
  signed: boolean;
}

export interface Transport {
  /** "serial" | "websocket" | "replay" | "bluetooth" | "webusb" | "webrtc" */
  readonly id: string;
  readonly capabilities: { duplex: boolean; reconnect: boolean };
  open(config: unknown): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  onState(cb: (s: ConnState) => void): () => void;
  stats(): LinkStats;
}

export interface TransportFactory {
  id: string;
  label: string;
  /** Capability detection (spec plan/01 §1.7). */
  isSupported(): boolean;
  /** Drives the connection UI form. */
  configSchema: unknown;
  create(): Transport;
}
