/**
 * Manual-control service tests (task T8.6; spec plan/04 §4.2 joystick, gated per
 * plan/08 §8.2). SAFETY-relevant: this drives the vehicle.
 *
 * Drives {@link ManualControlService} with a FAKE gamepad, a FAKE clock and a
 * capturing `send` — no Gamepad API or Worker. Covers RC_CHANNELS_OVERRIDE +
 * MANUAL_CONTROL encoding, the bounded send rate, explicit start/stop, the
 * focus-loss/disconnect failsafe, the armed gate, and button→action edges.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createManualControlService,
  NEUTRAL_SHAPE,
  RC_OVERRIDE_IGNORE,
  type AxisShape,
  type GamepadSnapshot,
  type ManualControlConfig,
  type ManualStopReason,
} from '../../src/mavlink/microservices/manual';

type Sent = { name: string; fields: Record<string, unknown> };

const shape = (p: Partial<AxisShape> = {}): AxisShape => ({ ...NEUTRAL_SHAPE, ...p });

/** A mutable fake gamepad the test drives. */
class FakeGamepad {
  axes: number[] = [0, 0, 0, 0];
  buttons: { pressed: boolean; value: number }[] = [];
  connected = true;
  present = true;

  setAxis(i: number, v: number): void {
    this.axes[i] = v;
  }

  press(i: number, pressed = true): void {
    while (this.buttons.length <= i) this.buttons.push({ pressed: false, value: 0 });
    this.buttons[i] = { pressed, value: pressed ? 1 : 0 };
  }

  snapshot(): GamepadSnapshot | undefined {
    if (!this.present) return undefined;
    return { axes: [...this.axes], buttons: [...this.buttons], connected: this.connected };
  }
}

/** A clock whose time the test advances explicitly. */
class FakeClock {
  t = 0;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

function setup(config: Partial<ManualControlConfig> = {}) {
  const sent: Sent[] = [];
  const gp = new FakeGamepad();
  const clock = new FakeClock();
  let armed = false;
  const events: { active: boolean; reason?: ManualStopReason }[] = [];
  const actions: string[] = [];
  const svc = createManualControlService({
    send: (name, fields) => {
      sent.push({ name, fields });
    },
    getGamepad: () => gp.snapshot(),
    now: clock.now,
    getTarget: () => ({ sysid: 7, compid: 1 }),
    isArmed: () => armed,
    config,
  });
  svc.onActiveChange((active, reason) =>
    events.push(reason === undefined ? { active } : { active, reason }),
  );
  svc.onAction((a) => actions.push(a));
  return { svc, sent, gp, clock, events, actions, setArmed: (v: boolean) => (armed = v) };
}

beforeEach(() => {
  /* each test builds its own service via setup() */
});

describe('ManualControlService — gating', () => {
  it('is off by default and sends nothing until start()', () => {
    const { svc, sent, gp } = setup({ rcChannels: [{ axis: 0, channel: 1, shape: shape() }] });
    expect(svc.isActive()).toBe(false);
    gp.setAxis(0, 1);
    svc.tick();
    expect(sent).toHaveLength(0);
  });

  it('start() emits the active event and the first tick sends immediately', () => {
    const { svc, sent, gp, events } = setup({
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
    });
    svc.start();
    expect(svc.isActive()).toBe(true);
    expect(events).toEqual([{ active: true }]);
    gp.setAxis(0, 1);
    svc.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe('RC_CHANNELS_OVERRIDE');
  });
});

describe('ManualControlService — RC_CHANNELS_OVERRIDE encoding', () => {
  it('maps axes to mapped channels (µs) and leaves the rest ignored (0)', () => {
    const { svc, sent, gp } = setup({
      mode: 'rc',
      rcChannels: [
        { axis: 0, channel: 1, shape: shape() },
        { axis: 1, channel: 3, shape: shape() },
      ],
    });
    svc.start();
    gp.setAxis(0, 1); // → 2000 µs
    gp.setAxis(1, -1); // → 1000 µs
    svc.tick();

    const f = sent[0]?.fields as Record<string, number>;
    expect(f.target_system).toBe(7);
    expect(f.target_component).toBe(1);
    expect(f.chan1_raw).toBe(2000);
    expect(f.chan3_raw).toBe(1000);
    // every other channel is the ignore sentinel
    expect(f.chan2_raw).toBe(RC_OVERRIDE_IGNORE);
    expect(f.chan4_raw).toBe(0);
    expect(f.chan8_raw).toBe(0);
    expect(f.chan18_raw).toBe(0);
  });
});

describe('ManualControlService — MANUAL_CONTROL mapping', () => {
  it('maps x/y/z/r axes (−1000…1000) and ORs pressed button bits into the mask', () => {
    const { svc, sent, gp } = setup({
      mode: 'manual',
      manualAxes: {
        x: { axis: 0, shape: shape() },
        y: { axis: 1, shape: shape() },
        z: { axis: 2, shape: shape() },
        r: { axis: 3, shape: shape() },
      },
      buttons: [
        { button: 0, bit: 0 },
        { button: 1, bit: 3 },
      ],
    });
    svc.start();
    gp.setAxis(0, 1); // x → 1000
    gp.setAxis(1, -0.5); // y → -500
    gp.setAxis(2, 0); // z → 0
    gp.setAxis(3, 0.25); // r → 250
    gp.press(0); // bit 0 → 1
    gp.press(1); // bit 3 → 8
    svc.tick();

    const f = sent[0]?.fields as Record<string, number>;
    expect(sent[0]?.name).toBe('MANUAL_CONTROL');
    expect(f.target).toBe(7);
    expect(f.x).toBe(1000);
    expect(f.y).toBe(-500);
    expect(f.z).toBe(0);
    expect(f.r).toBe(250);
    expect(f.buttons).toBe(0b1001); // bits 0 and 3
  });

  it('leaves unmapped manual axes at 0', () => {
    const { svc, sent, gp } = setup({
      mode: 'manual',
      manualAxes: { x: { axis: 0, shape: shape() } },
    });
    svc.start();
    gp.setAxis(0, 1);
    svc.tick();
    const f = sent[0]?.fields as Record<string, number>;
    expect(f.x).toBe(1000);
    expect(f.y).toBe(0);
    expect(f.z).toBe(0);
    expect(f.r).toBe(0);
    expect(f.buttons).toBe(0);
  });
});

describe('ManualControlService — rate limiting', () => {
  it('sends at most once per 1/rateHz interval off the injected clock', () => {
    const { svc, sent, gp, clock } = setup({
      rateHz: 25, // 40 ms interval
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
    });
    svc.start();
    gp.setAxis(0, 1);
    svc.tick(); // t=0 → send (1)
    expect(sent).toHaveLength(1);
    clock.advance(10);
    svc.tick(); // t=10 < 40 → no send
    expect(sent).toHaveLength(1);
    clock.advance(35);
    svc.tick(); // t=45 ≥ 40 → send (2)
    expect(sent).toHaveLength(2);
    clock.advance(5);
    svc.tick(); // t=50, < 40 since last → no send
    expect(sent).toHaveLength(2);
  });
});

describe('ManualControlService — start/stop + failsafe', () => {
  it('stop() ceases sending and emits one neutralising release frame', () => {
    const { svc, sent, gp, events } = setup({
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
      releaseOnStop: true,
    });
    svc.start();
    gp.setAxis(0, 1);
    svc.tick();
    expect(sent).toHaveLength(1);

    svc.stop();
    expect(svc.isActive()).toBe(false);
    // a release frame was sent with all channels ignored
    expect(sent).toHaveLength(2);
    const rel = sent[1]?.fields as Record<string, number>;
    expect(rel.chan1_raw).toBe(0);
    expect(rel.chan8_raw).toBe(0);
    expect(events.at(-1)).toEqual({ active: false, reason: 'user' });

    // no further sends after stop
    svc.tick();
    expect(sent).toHaveLength(2);
  });

  it('FAILSAFE: a gamepad disconnect while active stops + releases', () => {
    const { svc, sent, gp, events } = setup({
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
    });
    svc.start();
    gp.setAxis(0, 1);
    svc.tick();
    expect(sent).toHaveLength(1);

    gp.present = false; // pad vanished
    svc.tick();
    expect(svc.isActive()).toBe(false);
    expect(events.at(-1)).toEqual({ active: false, reason: 'gamepad-disconnect' });
    // a release frame was emitted by the failsafe
    expect(sent).toHaveLength(2);
    expect((sent[1]?.fields as Record<string, number>).chan1_raw).toBe(0);

    // a disconnected pad produces no further sends
    svc.tick();
    expect(sent).toHaveLength(2);
  });

  it('treats connected:false as a disconnect failsafe', () => {
    const { svc, sent, gp } = setup({ rcChannels: [{ axis: 0, channel: 1, shape: shape() }] });
    svc.start();
    svc.tick();
    expect(sent).toHaveLength(1);
    gp.connected = false;
    svc.tick();
    expect(svc.isActive()).toBe(false);
  });

  it('does not send a release when releaseOnStop is false', () => {
    const { svc, sent } = setup({
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
      releaseOnStop: false,
    });
    svc.start();
    svc.tick();
    expect(sent).toHaveLength(1);
    svc.stop();
    expect(sent).toHaveLength(1);
  });
});

describe('ManualControlService — armed gating', () => {
  it('suppresses sends until armed when requireArmed is set', () => {
    const { svc, sent, gp, clock, setArmed } = setup({
      requireArmed: true,
      rateHz: 25,
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
    });
    svc.start();
    gp.setAxis(0, 1);
    svc.tick(); // disarmed → suppressed
    expect(sent).toHaveLength(0);
    expect(svc.isActive()).toBe(true); // still active, just gated

    setArmed(true);
    clock.advance(50);
    svc.tick(); // armed → send
    expect(sent).toHaveLength(1);
  });
});

describe('ManualControlService — button actions', () => {
  it('fires a bound action once on each press (rising) edge', () => {
    const { svc, gp, actions } = setup({
      rcChannels: [{ axis: 0, channel: 1, shape: shape() }],
      buttons: [{ button: 2, action: 'rtl' }],
    });
    svc.start();
    svc.tick(); // not pressed
    expect(actions).toEqual([]);
    gp.press(2);
    svc.tick(); // rising edge
    svc.tick(); // held → no repeat
    expect(actions).toEqual(['rtl']);
    gp.press(2, false);
    svc.tick(); // release
    gp.press(2);
    svc.tick(); // second rising edge
    expect(actions).toEqual(['rtl', 'rtl']);
  });
});

describe('ManualControlService — config', () => {
  it('clamps rateHz into [1, 50]', () => {
    const { svc } = setup({ rateHz: 999 });
    expect(svc.getConfig().rateHz).toBe(50);
    svc.setConfig({ rateHz: 0 });
    expect(svc.getConfig().rateHz).toBe(1);
  });
});
