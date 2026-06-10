import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageEndpoint } from '../../src/core/bus';
import { RPC_SEND_MESSAGE, type SendMessageRequest } from '../../src/mavlink/host/protocol';
import { connectWorker } from '../../src/workers/rpc';

class PairedEndpoint implements MessageEndpoint {
  peer: PairedEndpoint | undefined;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  postMessage(message: unknown): void {
    const peer = this.peer;
    if (peer === undefined) throw new Error('endpoint is not paired');
    queueMicrotask(() => peer.onmessage?.(new MessageEvent('message', { data: message })));
  }
}

function createEndpointPair(): { main: PairedEndpoint; worker: PairedEndpoint } {
  const main = new PairedEndpoint();
  const worker = new PairedEndpoint();
  main.peer = worker;
  worker.peer = main;
  return { main, worker };
}

describe('mavlink.worker RPC_SEND_MESSAGE', () => {
  afterEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'self', { value: undefined, configurable: true });
  });

  it('rejects sends while the outgoing stream is disconnected', async () => {
    vi.resetModules();
    const { main, worker } = createEndpointPair();
    Object.defineProperty(globalThis, 'self', { value: worker, configurable: true });

    await import('../../src/workers/mavlink.worker');
    const rpc = connectWorker(main);
    const req: SendMessageRequest = { name: 'HEARTBEAT', fields: {} };

    await expect(rpc.call<SendMessageRequest, void>(RPC_SEND_MESSAGE, req)).rejects.toThrow(
      /outgoing stream/i,
    );
    rpc.dispose();
  });
});
