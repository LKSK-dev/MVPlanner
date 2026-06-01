/* global ReadableStream, WritableStream */
/**
 * Custom transport demo — first-party MVPlanner extension example.
 *
 * Tutorial points:
 * - advanced integrations register transport factories with `ctx.transports.register`;
 * - the sample transport is local-only and echoes no real vehicle bytes;
 * - transport factory registration is disposable like panels, layers, and themes.
 *
 * @typedef {import('../src/contracts').ExtContext} ExtContext
 */

export const manifest = {
  id: 'org.mvplanner.examples.custom-transport-demo',
  name: 'Custom Transport Demo',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Registers a no-op echo transport factory for integration tutorials.',
  author: 'MVPlanner',
  permissions: ['transport'],
  contributes: {
    transports: [{ id: 'examples.echo', title: 'Example Echo Transport' }],
  },
};

const makeEchoTransport = () => {
  let state = { kind: 'closed' };
  let bytesOut = 0;
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  return {
    id: 'examples.echo',
    capabilities: { duplex: true, reconnect: false },
    readable: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        bytesOut += chunk instanceof Uint8Array ? chunk.byteLength : 0;
      },
    }),
    async open(_config) {
      state = { kind: 'open' };
      emit();
    },
    async close() {
      state = { kind: 'closed' };
      emit();
    },
    onState(cb) {
      listeners.add(cb);
      cb(state);
      return () => {
        listeners.delete(cb);
      };
    },
    stats() {
      return { bytesIn: 0, bytesOut, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
    },
  };
};

/** @param {ExtContext} ctx */
export function activate(ctx) {
  const off = ctx.transports?.register({
    id: 'examples.echo',
    label: 'Example Echo Transport',
    isSupported: () => true,
    configSchema: { type: 'object', properties: {}, additionalProperties: false },
    create: makeEchoTransport,
  });
  if (off) ctx.onDispose(off);
}

export function deactivate() {}
