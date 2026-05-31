/**
 * `runAction` — the safety-critical confirm→command→audit flow (task T2.7; spec
 * plan/04 §4.2 "confirmations for destructive actions; disabled when unsafe",
 * plan/08 §8.3 gating + audit).
 *
 * For one {@link ActionId} + {@link ActionArgs} it:
 *  1. resolves the active vehicle and the action's gate — a disabled action (or
 *     no vehicle) returns `blocked` and does nothing;
 *  2. for a destructive action, asks {@link ActionsDeps.confirm} with an
 *     `armedAware` flag set when the vehicle is armed/in-air (stronger, blocking
 *     confirmation) — a declined confirm records a `cancelled` audit entry and
 *     returns without sending any command;
 *  3. appends a `pending` audit entry (the START record), invokes the injected
 *     {@link CommandClient} method, then updates the entry to `ok` / `error`
 *     (the RESULT record).
 *
 * Pure logic over injected seams: it unit-tests with a mock command client, a
 * mock confirm (resolving true/false) and a real {@link AuditLog}.
 */
import type { ConfirmOptions } from '../../../../contracts';
import type { AuditParams, AuditValue } from '../../../../core/audit';
import { ACTIONS, type ActionDescriptor } from './catalog';
import {
  IN_AIR_ALT_M,
  type ActionArgs,
  type ActionGateContext,
  type ActionId,
  type ActionOutcome,
  type ActionVehicle,
  type ActionsDeps,
  type TFn,
} from './types';

/** Identity translate used when no `t` is injected (key passthrough). */
const IDENTITY_T: TFn = (key) => key;

/** Derive the gate context from the (possibly absent) active vehicle. */
export function gateContextFor(vehicle: ActionVehicle | undefined): ActionGateContext {
  if (vehicle === undefined) {
    return { hasVehicle: false, armed: false, inAir: false, vehicleClass: 'unknown' };
  }
  const inAir =
    vehicle.armed && vehicle.position !== undefined && vehicle.position.altRelM > IN_AIR_ALT_M;
  return {
    hasVehicle: true,
    armed: vehicle.armed,
    inAir,
    vehicleClass: vehicle.vehicleClass,
  };
}

/** Collect the defined args (plus the action id) into a flat audit param map. */
function auditParams(id: ActionId, args: ActionArgs): AuditParams {
  const p: Record<string, AuditValue> = { action: id };
  if (args.altM !== undefined) p.altM = args.altM;
  if (args.lat !== undefined) p.lat = args.lat;
  if (args.lon !== undefined) p.lon = args.lon;
  if (args.speedMs !== undefined) p.speedMs = args.speedMs;
  if (args.mode !== undefined) p.mode = args.mode;
  if (args.seq !== undefined) p.seq = args.seq;
  return p;
}

/** Build the `armedAware`, destructive {@link ConfirmOptions} for an action. */
function confirmOptions(
  t: TFn,
  desc: ActionDescriptor,
  summary: string,
  gate: ActionGateContext,
): ConfirmOptions {
  const action = t(desc.labelKey);
  return {
    title: t('actions.confirm.title', { action }),
    body: t(desc.confirmBodyKey ?? 'actions.confirm.generic.body', { action, summary }),
    destructive: true,
    armedAware: gate.armed || gate.inAir,
  };
}

/**
 * Run the action `id` through confirm→command→audit. Never throws for an action
 * failure: the error is captured in the returned {@link ActionOutcome} and
 * recorded on the audit entry.
 */
export async function runAction(
  deps: ActionsDeps,
  id: ActionId,
  args: ActionArgs = {},
): Promise<ActionOutcome> {
  const desc = ACTIONS[id];
  const t = deps.t ?? IDENTITY_T;
  const now = deps.now ?? Date.now;
  const origin = deps.origin ?? 'ui';

  const vehicle = deps.getActiveVehicle();
  const gate = gateContextFor(vehicle);
  if (!desc.isEnabled(gate)) {
    return { status: 'blocked', reason: 'disabled' };
  }

  const summary = desc.summary(t, args);
  const params = auditParams(id, args);

  if (desc.destructive) {
    const ok = await deps.confirm(confirmOptions(t, desc, summary, gate));
    if (!ok) {
      deps.audit.append({
        kind: 'command',
        summary,
        origin,
        params,
        status: 'cancelled',
        result: 'cancelled',
        tMs: now(),
        tEndMs: now(),
      });
      return { status: 'cancelled' };
    }
  }

  const entry = deps.audit.append({
    kind: 'command',
    summary,
    origin,
    params,
    status: 'pending',
    tMs: now(),
  });

  try {
    await desc.run(deps.command, args);
    deps.audit.update(entry.id, { status: 'ok', result: 'ok', tEndMs: now() });
    return { status: 'ok', entryId: entry.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.audit.update(entry.id, { status: 'error', result: message, tEndMs: now() });
    return { status: 'error', entryId: entry.id, error: err };
  }
}
