/**
 * The pure action catalog (task T2.7; spec plan/04 §4.2 Actions).
 *
 * Each {@link ActionDescriptor} declares: the i18n label, whether it is
 * destructive (needs confirmation, spec plan/08 §8.3), a state-based gate
 * (`isEnabled`), the {@link CommandClient} call it performs (`run`), and how to
 * summarise it for the confirm dialog + audit entry. No DOM, no host — the whole
 * table unit-tests against a mock `CommandClient`.
 *
 * The wire ids for the two actions issued via the generic `command.send` path
 * (`DO_PAUSE_CONTINUE`, `DO_CHANGE_SPEED`) are MAVLink protocol constants pinned
 * here so this module does not reach into the command microservice internals
 * (it depends only on the frozen {@link CommandClient} contract).
 */
import type { CommandClient, VehicleClass } from '../../../../contracts';
import { arduMapForClass } from '../../../../vehicle';
import type { ActionArgs, ActionGateContext, ActionId, TFn } from './types';

/** `MAV_CMD_DO_PAUSE_CONTINUE` (193): param1 0 = pause, 1 = continue. */
const MAV_CMD_DO_PAUSE_CONTINUE = 193;
/** `MAV_CMD_DO_CHANGE_SPEED` (178). */
const MAV_CMD_DO_CHANGE_SPEED = 178;
/** `DO_CHANGE_SPEED` speed type 1 = ground speed. */
const SPEED_TYPE_GROUNDSPEED = 1;
/** `DO_CHANGE_SPEED` throttle "no change" sentinel. */
const THROTTLE_NO_CHANGE = -1;

/** One quick-action's metadata + behaviour. */
export interface ActionDescriptor {
  /** Stable action id. */
  readonly id: ActionId;
  /** i18n key for the button/command label. */
  readonly labelKey: string;
  /** Destructive actions require a safety confirmation before running. */
  readonly destructive: boolean;
  /** i18n key for the confirm-dialog body (destructive actions). */
  readonly confirmBodyKey?: string;
  /** State gate: whether the action is available for the given context. */
  isEnabled(ctx: ActionGateContext): boolean;
  /** Perform the action via the injected {@link CommandClient}. */
  run(command: CommandClient, args: ActionArgs): Promise<void>;
  /** Build the localised one-line summary for the confirm body + audit entry. */
  summary(t: TFn, args: ActionArgs): string;
}

/** `true` when an active vehicle is present (most actions need one). */
function present(ctx: ActionGateContext): boolean {
  return ctx.hasVehicle;
}

/** `true` when a vehicle is present AND armed (in-flight actions). */
function armed(ctx: ActionGateContext): boolean {
  return ctx.hasVehicle && ctx.armed;
}

/** Resolve a required mode arg or throw a clear error. */
function requireMode(args: ActionArgs): string {
  if (args.mode === undefined || args.mode === '') {
    throw new Error('actions: a mode name is required for setMode');
  }
  return args.mode;
}

/**
 * The full quick-action catalog keyed by {@link ActionId}. Order here is also
 * the natural display order in the bar.
 */
export const ACTIONS: Readonly<Record<ActionId, ActionDescriptor>> = {
  arm: {
    id: 'arm',
    labelKey: 'actions.arm',
    destructive: true,
    confirmBodyKey: 'actions.confirm.arm.body',
    isEnabled: (c) => c.hasVehicle && !c.armed,
    run: (command) => command.arm(true),
    summary: (t) => t('actions.arm'),
  },
  disarm: {
    id: 'disarm',
    labelKey: 'actions.disarm',
    destructive: true,
    confirmBodyKey: 'actions.confirm.disarm.body',
    isEnabled: armed,
    run: (command) => command.arm(false),
    summary: (t) => t('actions.disarm'),
  },
  takeoff: {
    id: 'takeoff',
    labelKey: 'actions.takeoff',
    destructive: true,
    confirmBodyKey: 'actions.confirm.takeoff.body',
    isEnabled: armed,
    run: (command, args) => command.takeoff(args.altM ?? 0),
    summary: (t, args) => t('actions.summary.takeoff', { alt: args.altM ?? 0 }),
  },
  land: {
    id: 'land',
    labelKey: 'actions.land',
    destructive: true,
    confirmBodyKey: 'actions.confirm.land.body',
    isEnabled: armed,
    run: (command) => command.land(),
    summary: (t) => t('actions.land'),
  },
  rtl: {
    id: 'rtl',
    labelKey: 'actions.rtl',
    destructive: true,
    confirmBodyKey: 'actions.confirm.rtl.body',
    isEnabled: armed,
    run: (command) => command.rtl(),
    summary: (t) => t('actions.rtl'),
  },
  loiter: {
    id: 'loiter',
    labelKey: 'actions.loiter',
    destructive: true,
    confirmBodyKey: 'actions.confirm.mode.body',
    isEnabled: present,
    run: (command) => command.setMode('LOITER'),
    summary: (t) => t('actions.summary.setMode', { mode: 'LOITER' }),
  },
  auto: {
    id: 'auto',
    labelKey: 'actions.auto',
    destructive: true,
    confirmBodyKey: 'actions.confirm.auto.body',
    isEnabled: present,
    run: (command) => command.setMode('AUTO'),
    summary: (t) => t('actions.summary.setMode', { mode: 'AUTO' }),
  },
  pause: {
    id: 'pause',
    labelKey: 'actions.pause',
    destructive: true,
    confirmBodyKey: 'actions.confirm.pause.body',
    isEnabled: armed,
    run: async (command) => {
      await command.send(MAV_CMD_DO_PAUSE_CONTINUE, [0]);
    },
    summary: (t) => t('actions.pause'),
  },
  resume: {
    id: 'resume',
    labelKey: 'actions.resume',
    destructive: true,
    confirmBodyKey: 'actions.confirm.resume.body',
    isEnabled: armed,
    run: async (command) => {
      await command.send(MAV_CMD_DO_PAUSE_CONTINUE, [1]);
    },
    summary: (t) => t('actions.resume'),
  },
  setMode: {
    id: 'setMode',
    labelKey: 'actions.setMode',
    destructive: true,
    confirmBodyKey: 'actions.confirm.mode.body',
    isEnabled: present,
    run: (command, args) => command.setMode(requireMode(args)),
    summary: (t, args) => t('actions.summary.setMode', { mode: args.mode ?? '' }),
  },
  setCurrentWp: {
    id: 'setCurrentWp',
    labelKey: 'actions.setCurrentWp',
    destructive: true,
    confirmBodyKey: 'actions.confirm.setCurrentWp.body',
    isEnabled: present,
    run: (command, args) => command.setCurrentWp(args.seq ?? 0),
    summary: (t, args) => t('actions.summary.setCurrentWp', { seq: args.seq ?? 0 }),
  },
  guidedGoto: {
    id: 'guidedGoto',
    labelKey: 'actions.guidedGoto',
    destructive: true,
    confirmBodyKey: 'actions.confirm.goto.body',
    isEnabled: armed,
    run: (command, args) => command.guidedGoto(args.lat ?? 0, args.lon ?? 0, args.altM ?? 0),
    summary: (t, args) =>
      t('actions.summary.goto', { lat: args.lat ?? 0, lon: args.lon ?? 0, alt: args.altM ?? 0 }),
  },
  guidedChangeAlt: {
    id: 'guidedChangeAlt',
    labelKey: 'actions.guidedChangeAlt',
    destructive: true,
    confirmBodyKey: 'actions.confirm.changeAlt.body',
    isEnabled: armed,
    // "Change altitude" re-targets the current position at a new altitude.
    run: (command, args) => command.guidedGoto(args.lat ?? 0, args.lon ?? 0, args.altM ?? 0),
    summary: (t, args) => t('actions.summary.changeAlt', { alt: args.altM ?? 0 }),
  },
  changeSpeed: {
    id: 'changeSpeed',
    labelKey: 'actions.changeSpeed',
    destructive: true,
    confirmBodyKey: 'actions.confirm.changeSpeed.body',
    isEnabled: armed,
    run: async (command, args) => {
      await command.send(MAV_CMD_DO_CHANGE_SPEED, [
        SPEED_TYPE_GROUNDSPEED,
        args.speedMs ?? 0,
        THROTTLE_NO_CHANGE,
        0,
        0,
        0,
        0,
      ]);
    },
    summary: (t, args) => t('actions.summary.changeSpeed', { speed: args.speedMs ?? 0 }),
  },
  setRoi: {
    id: 'setRoi',
    labelKey: 'actions.setRoi',
    // ROI only re-points the vehicle/gimbal — audited but not confirm-gated.
    destructive: false,
    isEnabled: present,
    run: (command, args) => command.setRoi(args.lat ?? 0, args.lon ?? 0, args.altM ?? 0),
    summary: (t, args) => t('actions.summary.setRoi', { lat: args.lat ?? 0, lon: args.lon ?? 0 }),
  },
  clearRoi: {
    id: 'clearRoi',
    labelKey: 'actions.clearRoi',
    destructive: false,
    isEnabled: present,
    run: (command) => command.clearRoi(),
    summary: (t) => t('actions.clearRoi'),
  },
  restartMission: {
    id: 'restartMission',
    labelKey: 'actions.restartMission',
    destructive: true,
    confirmBodyKey: 'actions.confirm.restartMission.body',
    isEnabled: present,
    run: (command) => command.setCurrentWp(0),
    summary: (t) => t('actions.restartMission'),
  },
  emergencyStop: {
    id: 'emergencyStop',
    labelKey: 'actions.emergencyStop',
    destructive: true,
    confirmBodyKey: 'actions.confirm.emergencyStop.body',
    // Always available whenever a vehicle is present — never gated by arm state.
    isEnabled: present,
    run: (command) => command.arm(false, true),
    summary: (t) => t('actions.emergencyStop'),
  },
};

/** Ordered list of all action descriptors (display + iteration order). */
export const ACTION_LIST: readonly ActionDescriptor[] = Object.values(ACTIONS);

/**
 * Vehicle-aware flight-mode names for `setMode`, derived from the ArduPilot mode
 * tables in `src/vehicle` (spec plan/04 §4.11). Returns an empty list for an
 * unknown class (the UI then hides/disables the mode picker).
 */
export function modeNamesFor(vehicleClass: VehicleClass | undefined): readonly string[] {
  if (vehicleClass === undefined) return [];
  const table = arduMapForClass(vehicleClass);
  if (table === undefined) return [];
  return Object.values(table);
}
