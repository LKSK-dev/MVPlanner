/**
 * Sandbox host⇄guest RPC protocol (task T7.2; spec plan/06 §6.6).
 *
 * A tiny set of method names + payload narrowers exchanged over the
 * {@link import('../../core/bus').PostMessageRpc} bridge between the host
 * (which owns the {@link import('../permissions').PermissionBroker}) and the
 * sandbox guest (Worker / in-process). Payloads cross the boundary as `unknown`
 * and are narrowed here (audited postMessage boundary, impl 00 §0.3).
 */
import type { ExtManifest } from '../../contracts';

/** Host → guest: hand over the code, manifest, and granted method names. */
export const GUEST_INIT = 'guest.init';
/** Host → guest: run the extension's `activate(ctx)`. */
export const GUEST_ACTIVATE = 'guest.activate';
/** Host → guest: run the extension's `deactivate()`. */
export const GUEST_DEACTIVATE = 'guest.deactivate';
/** Guest → host: invoke a brokered privileged method. */
export const BROKER_INVOKE = 'broker.invoke';
/** Guest → host: liveness heartbeat (feeds the CPU/loop watchdog). */
export const HOST_HEARTBEAT = 'host.heartbeat';

/** {@link GUEST_INIT} payload. */
export interface InitRequest {
  code: string;
  manifest: ExtManifest;
  methods: string[];
}

/** {@link BROKER_INVOKE} payload. */
export interface InvokeRequest {
  method: string;
  args: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('sandbox RPC payload must be an object');
  }
  return value as Record<string, unknown>;
}

/** Narrow an untrusted {@link GUEST_INIT} payload. */
export function narrowInit(req: unknown): InitRequest {
  const rec = asRecord(req);
  const code = rec.code;
  const manifest = rec.manifest;
  const methods = rec.methods;
  if (typeof code !== 'string') throw new Error('init payload: code must be a string');
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('init payload: manifest must be an object');
  }
  if (!Array.isArray(methods) || !methods.every((m): m is string => typeof m === 'string')) {
    throw new Error('init payload: methods must be a string[]');
  }
  return { code, manifest: manifest as ExtManifest, methods };
}

/** Narrow an untrusted {@link BROKER_INVOKE} payload. */
export function narrowInvoke(req: unknown): InvokeRequest {
  const rec = asRecord(req);
  const method = rec.method;
  if (typeof method !== 'string') throw new Error('invoke payload: method must be a string');
  const args = Array.isArray(rec.args) ? (rec.args as unknown[]) : [];
  return { method, args };
}
