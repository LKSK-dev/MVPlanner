/**
 * MAVLink forwarding control (task T8.5 integration; spec plan/03 §3.5
 * forwarding, plan/04 §4.1 SHOULD).
 *
 * Rebroadcasts the ACTIVE link's received MAVLink traffic to a SECONDARY link
 * via {@link createForwarder}. The host owns the active transport's byte stream,
 * so the source for the forwarder is an adapter over the host's never-dropped
 * raw-frame tap ({@link MavlinkHost.onRawFrame}): each parsed frame's raw bytes
 * are streamed verbatim to the chosen secondary transport. This matches T8.5
 * ("rebroadcast received traffic to a secondary link"); per-frame bytes are the
 * exact wire bytes, so no re-encoding happens.
 *
 * {@link createForwardController} is the headless controller (unit-tested with a
 * fake host + factory); {@link ForwardControl} is the minimal drawer UI bound to
 * it through the connection context.
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import type { LinkStats, Transport, TransportFactory } from '../../../contracts';
import { BUILTIN_TRANSPORT_FACTORIES } from '../../../transport';
import { createForwarder, type Forwarder, type ForwarderStats } from '../../../transport/forward';
import { formatInteger, registerMessages, t } from '../../../core/i18n';
import { normalizeConfigSchema, type FormField } from './config-form';

/** Owned `forward.*` integration strings. */
const FORWARD_MESSAGES: Readonly<Record<string, string>> = {
  'forward.title': 'Forward link',
  'forward.description': 'Rebroadcast the active link to a secondary transport.',
  'forward.target': 'Forward to',
  'forward.start': 'Start forwarding',
  'forward.stop': 'Stop forwarding',
  'forward.starting': 'Starting…',
  'forward.active': 'Forwarding to {target}',
  'forward.idle': 'Not forwarding',
  'forward.error': 'Forwarding error',
  'forward.stat.frames': 'Frames forwarded',
  'forward.stat.dropped': 'Dropped',
};
registerMessages(FORWARD_MESSAGES);

/** The minimal host slice the forwarder source taps (the real host satisfies it). */
export interface ForwardSourceHost {
  /** Subscribe to EVERY parsed frame; returns an unsubscribe fn. */
  onRawFrame(cb: (frame: { readonly raw: Uint8Array }) => void): () => void;
}

/** A fresh zeroed {@link LinkStats} for the synthetic source transport. */
function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

/**
 * Build a read-only source {@link Transport} whose `readable` streams the host's
 * raw frame bytes. `writable` is a discarding sink (forwarding is one-way).
 */
function createRawFrameSource(host: ForwardSourceHost): Transport {
  let unsub: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      unsub = host.onRawFrame((frame) => {
        try {
          controller.enqueue(frame.raw);
        } catch {
          /* stream closed/errored — forwarding has stopped */
        }
      });
    },
    cancel() {
      unsub?.();
      unsub = undefined;
    },
  });
  const detach = (): void => {
    unsub?.();
    unsub = undefined;
  };
  return {
    id: 'active-link',
    capabilities: { duplex: false, reconnect: false },
    open: () => Promise.resolve(),
    close: () => {
      detach();
      return Promise.resolve();
    },
    readable,
    writable: new WritableStream<Uint8Array>(),
    onState: () => () => undefined,
    stats: zeroLink,
  };
}

/** Headless forwarding controller (one active forward at a time). */
export interface ForwardController {
  /** Begin forwarding the active link to a new `factoryId` transport with `config`. */
  start(factoryId: string, config: unknown): Promise<void>;
  /** Stop forwarding and close the secondary transport. Safe when idle. */
  stop(): Promise<void>;
  /** Whether a forward is currently active. */
  isForwarding(): boolean;
  /** The secondary transport id while forwarding, else `undefined`. */
  targetId(): string | undefined;
  /** Current forwarder counters, or `undefined` when idle. */
  stats(): ForwarderStats | undefined;
  /** Stop forwarding (best-effort) for teardown. */
  dispose(): void;
}

/** Options for {@link createForwardController}. */
export interface ForwardControllerOptions {
  /** The host whose raw frames are rebroadcast. */
  readonly host: ForwardSourceHost;
  /** Transport factories to forward into (default the built-ins). */
  readonly factories?: readonly TransportFactory[];
}

/** Construct an {@link ForwardController} over the host raw-frame tap. */
export function createForwardController(options: ForwardControllerOptions): ForwardController {
  const factories = options.factories ?? BUILTIN_TRANSPORT_FACTORIES;
  let forwarder: Forwarder | undefined;
  let source: Transport | undefined;
  let target: Transport | undefined;

  const teardown = async (): Promise<void> => {
    forwarder?.stop();
    forwarder = undefined;
    const closingTarget = target;
    const closingSource = source;
    target = undefined;
    source = undefined;
    if (closingTarget !== undefined) {
      try {
        await closingTarget.close();
      } catch {
        /* already closed */
      }
    }
    if (closingSource !== undefined) {
      try {
        await closingSource.close();
      } catch {
        /* already closed */
      }
    }
  };

  return {
    async start(factoryId: string, config: unknown): Promise<void> {
      if (forwarder !== undefined) await teardown();
      const factory = factories.find((f) => f.id === factoryId);
      if (factory === undefined) throw new Error(`unknown transport factory: ${factoryId}`);
      const nextTarget = factory.create();
      await nextTarget.open(config);
      const nextSource = createRawFrameSource(options.host);
      const nextForwarder = createForwarder({ source: nextSource, targets: [nextTarget] });
      nextForwarder.start();
      source = nextSource;
      target = nextTarget;
      forwarder = nextForwarder;
    },
    async stop(): Promise<void> {
      await teardown();
    },
    isForwarding(): boolean {
      return forwarder !== undefined;
    },
    targetId(): string | undefined {
      return target?.id;
    },
    stats() {
      return forwarder?.stats();
    },
    dispose(): void {
      void teardown();
    },
  };
}

/** Stats poll cadence (ms) for the forwarding readout. */
const STATS_POLL_MS = 750;

/** A form-control value while editing the secondary transport config. */
type FormValue = string | number | File;

/** {@link ForwardControl} props. */
export interface ForwardControlProps {
  /** The forwarding controller (from the connection context). */
  readonly controller: ForwardController;
  /** Transport factories offered as forward targets (default the built-ins). */
  readonly factories?: readonly TransportFactory[];
}

/** Localized transport name (`transport.name.<id>`), falling back to the label. */
function transportLabel(factory: TransportFactory): string {
  const key = `transport.name.${factory.id}`;
  const localized = t(key);
  return localized === key ? factory.label : localized;
}

/** Assemble a transport `open()` config from the current form values. */
async function buildConfig(
  fields: readonly FormField[],
  values: Record<string, FormValue | undefined>,
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.kind === 'file') {
      if (v instanceof File) config[f.key] = await v.arrayBuffer();
    } else if (f.kind === 'select' || f.kind === 'number') {
      config[f.key] = typeof v === 'number' ? v : f.value;
    } else {
      config[f.key] = typeof v === 'string' ? v : '';
    }
  }
  return config;
}

/**
 * Minimal forwarding control for the connection drawer: pick a secondary
 * transport, start/stop forwarding, and read live forward/drop counters.
 */
export const ForwardControl: Component<ForwardControlProps> = (props) => {
  // The active link cannot itself be a forward target; replay is a file source,
  // not a sink, so it is excluded too.
  const factories = (): readonly TransportFactory[] =>
    (props.factories ?? BUILTIN_TRANSPORT_FACTORIES).filter(
      (f) => f.id !== 'replay' && f.isSupported(),
    );

  const [selectedId, setSelectedId] = createSignal<string>(factories()[0]?.id ?? '');
  const [values, setValues] = createSignal<Record<string, FormValue | undefined>>({});
  const [busy, setBusy] = createSignal(false);
  const [forwarding, setForwarding] = createSignal(props.controller.isForwarding());
  const [error, setError] = createSignal<string | undefined>();
  const [stats, setStats] = createSignal(props.controller.stats());

  const selectedFactory = createMemo(() => factories().find((f) => f.id === selectedId()));
  const fields = createMemo<FormField[]>(() => {
    const factory = selectedFactory();
    return factory ? normalizeConfigSchema(factory.id, factory.configSchema) : [];
  });

  // Reset form values to schema defaults whenever the target transport changes.
  createEffect(() => {
    const init: Record<string, FormValue | undefined> = {};
    for (const f of fields()) {
      if (f.kind === 'select' || f.kind === 'number' || f.kind === 'text') init[f.key] = f.value;
    }
    setValues(init);
  });

  // Poll the forwarder counters while active.
  createEffect(() => {
    if (!forwarding()) return;
    const id = setInterval(() => setStats(props.controller.stats()), STATS_POLL_MS);
    onCleanup(() => clearInterval(id));
  });

  const setValue = (key: string, v: FormValue): void => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const handleStart = async (): Promise<void> => {
    const factory = selectedFactory();
    if (factory === undefined) return;
    setError(undefined);
    setBusy(true);
    try {
      const config = await buildConfig(fields(), values());
      await props.controller.start(factory.id, config);
      setForwarding(true);
      setStats(props.controller.stats());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async (): Promise<void> => {
    setBusy(true);
    try {
      await props.controller.stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setForwarding(false);
      setStats(props.controller.stats());
      setBusy(false);
    }
  };

  const forwardedFrames = (): number =>
    stats()?.targets.reduce((sum, tch) => sum + tch.sourceToTarget.chunksForwarded, 0) ?? 0;
  const droppedFrames = (): number =>
    stats()?.targets.reduce((sum, tch) => sum + tch.sourceToTarget.chunksDropped, 0) ?? 0;

  return (
    <section
      class="mvp-conn__forward"
      aria-label={t('forward.title')}
      data-testid="forward-control"
    >
      <h3>{t('forward.title')}</h3>
      <p class="mvp-conn__forward-desc">{t('forward.description')}</p>

      <div class="mvp-conn__field">
        <label for="mvp-forward-target">{t('forward.target')}</label>
        <select
          id="mvp-forward-target"
          data-testid="forward-target"
          disabled={busy() || forwarding()}
          value={selectedId()}
          onChange={(e) => setSelectedId(e.currentTarget.value)}
        >
          <For each={factories()}>{(f) => <option value={f.id}>{transportLabel(f)}</option>}</For>
        </select>
      </div>

      <For each={fields()}>
        {(f) => (
          <div class="mvp-conn__field">
            <label for={`mvp-forward-field-${f.key}`}>{t(f.labelKey)}</label>
            <Show
              when={f.kind === 'select' && f}
              fallback={
                <input
                  id={`mvp-forward-field-${f.key}`}
                  type={f.kind === 'number' ? 'number' : f.kind === 'file' ? 'file' : 'text'}
                  disabled={busy() || forwarding()}
                  value={
                    f.kind === 'file'
                      ? undefined
                      : String(values()[f.key] ?? (f.kind === 'text' ? '' : ''))
                  }
                  onInput={(e) => {
                    if (f.kind === 'number') setValue(f.key, Number(e.currentTarget.value));
                    else if (f.kind !== 'file') setValue(f.key, e.currentTarget.value);
                  }}
                  onChange={(e) => {
                    if (f.kind === 'file') {
                      const file = e.currentTarget.files?.[0];
                      if (file) setValue(f.key, file);
                    }
                  }}
                />
              }
            >
              {(field) => (
                <select
                  id={`mvp-forward-field-${field().key}`}
                  disabled={busy() || forwarding()}
                  value={String(values()[field().key] ?? field().value)}
                  onChange={(e) => setValue(field().key, Number(e.currentTarget.value))}
                >
                  <For each={field().options}>
                    {(o) => <option value={String(o.value)}>{o.label}</option>}
                  </For>
                </select>
              )}
            </Show>
          </div>
        )}
      </For>

      <Show when={error()}>
        <p class="mvp-conn__error" role="alert">
          {t('forward.error')}: {error()}
        </p>
      </Show>

      <div class="mvp-conn__forward-actions">
        <Show
          when={forwarding()}
          fallback={
            <button
              type="button"
              class="mvp-btn mvp-btn--primary"
              data-testid="forward-start"
              disabled={busy() || selectedFactory() === undefined}
              onClick={() => void handleStart()}
            >
              {busy() ? t('forward.starting') : t('forward.start')}
            </button>
          }
        >
          <button
            type="button"
            class="mvp-btn mvp-btn--danger"
            data-testid="forward-stop"
            disabled={busy()}
            onClick={() => void handleStop()}
          >
            {t('forward.stop')}
          </button>
        </Show>
      </div>

      <p class="mvp-conn__forward-state" data-testid="forward-state" data-forwarding={forwarding()}>
        <Show when={forwarding()} fallback={t('forward.idle')}>
          {t('forward.active', { target: props.controller.targetId() ?? '' })}
        </Show>
      </p>

      <Show when={forwarding()}>
        <dl class="mvp-conn__forward-stats" data-testid="forward-stats">
          <div>
            <dt>{t('forward.stat.frames')}</dt>
            <dd data-testid="forward-frames">{formatInteger(forwardedFrames())}</dd>
          </div>
          <div>
            <dt>{t('forward.stat.dropped')}</dt>
            <dd data-testid="forward-dropped">{formatInteger(droppedFrames())}</dd>
          </div>
        </dl>
      </Show>
    </section>
  );
};
