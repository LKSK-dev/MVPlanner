/**
 * Connection drawer (T1.10; spec plan/03 §3.5 / §3.7, plan/04 §4.1, plan/05
 * §5.2 "Connection drawer").
 *
 * Opened from the top-bar connection chip and the `Connect / Disconnect` command
 * (registered by {@link import('./provider').ConnectionProvider}). It:
 *  - lists the built-in transports, FILTERED by `factory.isSupported()` so
 *    Web Serial / BLE / USB show a "not supported in this browser" hint when the
 *    platform lacks them (capability degradation, spec plan/05 §5.7);
 *  - renders a config form derived pragmatically from each `factory.configSchema`
 *    (serial baud select / websocket url / replay tlog file + speed);
 *  - shows Connect / Disconnect reflecting the live `ConnState`;
 *  - renders a live link-diagnostics readout (rate / loss / rssi / signed /
 *    bytes) and a detected-vehicle / active-vehicle selector.
 *
 * Accessible: a labelled dialog, focus moves in on open and is restored on
 * close, Escape closes, all copy via `t()`.
 */
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import type { TransportFactory } from '../../../contracts';
import { BUILTIN_TRANSPORT_FACTORIES } from '../../../transport';
import { formatDecimal, formatInteger, t } from '../../../core/i18n';
import { useConnection } from './context';
import { normalizeConfigSchema, type FormField } from './config-form';
import { ForwardControl } from './forward-control';

/** A form control value while editing. */
type FormValue = string | number | File;

/** Localized transport name (`transport.name.<id>`), falling back to the label. */
function transportLabel(factory: TransportFactory): string {
  const key = `transport.name.${factory.id}`;
  const localized = t(key);
  return localized === key ? factory.label : localized;
}

/** Catalog lookup that returns `undefined` (not the key) when a key is missing. */
function optionalT(key: string): string | undefined {
  const value = t(key);
  return value === key ? undefined : value;
}

/** Stable DOM id for a field control + its label. */
function fieldId(key: string): string {
  return `mvp-conn-field-${key}`;
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

/** The connection drawer overlay. Renders nothing unless open. */
export const ConnectionDrawer: Component = () => {
  const conn = useConnection();
  if (!conn) return null;

  const firstSupported = BUILTIN_TRANSPORT_FACTORIES.find((f) => f.isSupported());
  const [selectedFactoryId, setSelectedFactoryId] = createSignal<string>(
    firstSupported?.id ?? BUILTIN_TRANSPORT_FACTORIES[0]?.id ?? '',
  );
  const [values, setValues] = createSignal<Record<string, FormValue | undefined>>({});
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  let panelEl: HTMLDivElement | undefined;
  let restoreFocusEl: HTMLElement | null = null;

  const selectedFactory = createMemo(() =>
    BUILTIN_TRANSPORT_FACTORIES.find((f) => f.id === selectedFactoryId()),
  );
  const fields = createMemo<FormField[]>(() => {
    const factory = selectedFactory();
    return factory ? normalizeConfigSchema(factory.id, factory.configSchema) : [];
  });

  // Reset form values to schema defaults whenever the transport changes.
  createEffect(() => {
    const init: Record<string, FormValue | undefined> = {};
    for (const f of fields()) {
      if (f.kind === 'select' || f.kind === 'number') init[f.key] = f.value;
      else if (f.kind === 'text') init[f.key] = f.value;
    }
    setValues(init);
  });

  // Move focus into the drawer on open; restore it to the trigger on close.
  createEffect(() => {
    if (conn.drawerOpen()) {
      restoreFocusEl = document.activeElement as HTMLElement | null;
      queueMicrotask(() => panelEl?.focus());
    } else if (restoreFocusEl) {
      const el = restoreFocusEl;
      restoreFocusEl = null;
      queueMicrotask(() => el.focus?.());
    }
  });

  const connState = (): string => conn.state().kind;
  const isConnected = (): boolean =>
    connState() === 'open' || connState() === 'opening' || connState() === 'reconnecting';
  const locked = (): boolean => busy() || isConnected();

  const canConnect = createMemo<boolean>(() => {
    if (locked()) return false;
    for (const f of fields()) {
      const v = values()[f.key];
      if (f.kind === 'text' && f.required && !(typeof v === 'string' && v.trim() !== '')) {
        return false;
      }
      if (f.kind === 'file' && f.required && !(v instanceof File)) return false;
    }
    return true;
  });

  const setValue = (key: string, v: FormValue): void => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const handleConnect = async (): Promise<void> => {
    const factory = selectedFactory();
    if (!factory) return;
    setError(undefined);
    setBusy(true);
    try {
      const config = await buildConfig(fields(), values());
      await conn.manager.connect(factory.id, config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setError(undefined);
    setBusy(true);
    try {
      await conn.manager.disconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      conn.closeDrawer();
      return;
    }
    if (e.key !== 'Tab') return;
    // Trap Tab/Shift+Tab between the first and last focusable child (matches
    // the alert-center / command-palette modal pattern).
    const focusables = Array.from(
      panelEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const current = document.activeElement;
    if (e.shiftKey) {
      if (current === first || current === panelEl) {
        e.preventDefault();
        last.focus();
      }
    } else if (current === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /** The transport-level error message when the link state is `error`. */
  const stateErrorMessage = (): string | undefined => {
    const state = conn.state();
    return state.kind === 'error' ? state.message : undefined;
  };

  return (
    <Show when={conn.drawerOpen()}>
      <div class="mvp-conn-backdrop" onClick={() => conn.closeDrawer()}>
        <div
          ref={panelEl}
          class="mvp-conn-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mvp-conn-title"
          tabIndex={-1}
          data-testid="connection-drawer"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <header class="mvp-conn-drawer__header">
            <h2 id="mvp-conn-title" class="mvp-conn-drawer__title">
              {t('conn.drawer.title')}
            </h2>
            <button
              type="button"
              class="mvp-conn-drawer__close"
              aria-label={t('conn.drawer.close')}
              onClick={() => conn.closeDrawer()}
            >
              ×
            </button>
          </header>

          <p class="mvp-conn-drawer__state" data-testid="connection-state">
            {t(`conn.${connState()}`)}
          </p>

          <fieldset class="mvp-conn__transports" disabled={locked()}>
            <legend>{t('conn.transport')}</legend>
            <For each={BUILTIN_TRANSPORT_FACTORIES}>
              {(factory) => {
                const supported = factory.isSupported();
                return (
                  <label
                    class="mvp-conn__transport"
                    classList={{ 'mvp-conn__transport--disabled': !supported }}
                    data-testid={`transport-${factory.id}`}
                    data-supported={supported ? 'true' : 'false'}
                  >
                    <input
                      type="radio"
                      name="mvp-conn-transport"
                      value={factory.id}
                      checked={selectedFactoryId() === factory.id}
                      disabled={!supported}
                      onChange={() => setSelectedFactoryId(factory.id)}
                    />
                    <span class="mvp-conn__transport-label">{transportLabel(factory)}</span>
                    <Show when={!supported}>
                      <span class="mvp-conn__transport-hint">
                        {t('conn.transport.unsupported')}
                      </span>
                    </Show>
                  </label>
                );
              }}
            </For>
          </fieldset>

          <div class="mvp-conn__form" data-testid="connection-form">
            <For each={fields()}>
              {(f) => (
                <div class="mvp-conn__field">
                  <label for={fieldId(f.key)}>{t(f.labelKey)}</label>
                  <Switch>
                    <Match when={f.kind === 'select' && f}>
                      {(field) => (
                        <select
                          id={fieldId(field().key)}
                          disabled={locked()}
                          value={String(values()[field().key] ?? field().value)}
                          onChange={(e) => setValue(field().key, Number(e.currentTarget.value))}
                        >
                          <For each={field().options}>
                            {(o) => <option value={String(o.value)}>{o.label}</option>}
                          </For>
                        </select>
                      )}
                    </Match>
                    <Match when={f.kind === 'text' && f}>
                      {(field) => (
                        <input
                          id={fieldId(field().key)}
                          type="text"
                          disabled={locked()}
                          required={field().required}
                          placeholder={
                            optionalT(`${field().labelKey}.placeholder`) ??
                            field().placeholder ??
                            ''
                          }
                          value={String(values()[field().key] ?? '')}
                          onInput={(e) => setValue(field().key, e.currentTarget.value)}
                        />
                      )}
                    </Match>
                    <Match when={f.kind === 'number' && f}>
                      {(field) => (
                        <input
                          id={fieldId(field().key)}
                          type="number"
                          disabled={locked()}
                          min={field().min}
                          max={field().max}
                          value={String(values()[field().key] ?? field().value)}
                          onInput={(e) => setValue(field().key, Number(e.currentTarget.value))}
                        />
                      )}
                    </Match>
                    <Match when={f.kind === 'file' && f}>
                      {(field) => (
                        <input
                          id={fieldId(field().key)}
                          type="file"
                          disabled={locked()}
                          required={field().required}
                          onChange={(e) => {
                            const file = e.currentTarget.files?.[0];
                            if (file) setValue(field().key, file);
                          }}
                        />
                      )}
                    </Match>
                  </Switch>
                </div>
              )}
            </For>
          </div>

          <Show when={error() ?? stateErrorMessage()}>
            {(message) => (
              <p class="mvp-conn__error" role="alert">
                {t('conn.error.title')}: {message()}
              </p>
            )}
          </Show>

          <div class="mvp-conn__actions">
            <Show
              when={isConnected()}
              fallback={
                <button
                  type="button"
                  class="mvp-btn mvp-btn--primary"
                  data-testid="connect-btn"
                  disabled={!canConnect()}
                  onClick={() => void handleConnect()}
                >
                  {busy() ? t('conn.connecting') : t('conn.connect')}
                </button>
              }
            >
              <button
                type="button"
                class="mvp-btn mvp-btn--danger"
                data-testid="disconnect-btn"
                disabled={busy()}
                onClick={() => void handleDisconnect()}
              >
                {t('conn.disconnect')}
              </button>
            </Show>
          </div>

          <section class="mvp-conn__vehicles" aria-label={t('conn.vehicles')}>
            <h3>{t('conn.vehicles')}</h3>
            <Show
              when={conn.vehicles().length > 0}
              fallback={<p class="mvp-conn__empty">{t('conn.noVehicles')}</p>}
            >
              <label for="mvp-conn-active-vehicle">{t('conn.vehicle.active')}</label>
              <select
                id="mvp-conn-active-vehicle"
                data-testid="active-vehicle"
                value={String(conn.activeSysid() ?? '')}
                onChange={(e) => conn.manager.setActiveVehicle(Number(e.currentTarget.value))}
              >
                <For each={conn.vehicles()}>
                  {(v) => (
                    <option value={String(v.sysid)}>
                      {t('conn.vehicle.label', { sysid: v.sysid, mode: v.mode })}
                    </option>
                  )}
                </For>
              </select>
            </Show>
          </section>

          <Show when={conn.forwarder}>
            {(controller) => <ForwardControl controller={controller()} />}
          </Show>

          <section class="mvp-conn__diag" aria-label={t('conn.diagnostics')}>
            <h3>{t('conn.diagnostics')}</h3>
            <dl class="mvp-conn__diag-grid" data-testid="link-diagnostics">
              <div>
                <dt>{t('conn.diag.rate')}</dt>
                <dd data-testid="diag-rate">{formatDecimal(conn.stats().rateHz, 1)} Hz</dd>
              </div>
              <div>
                <dt>{t('conn.diag.loss')}</dt>
                <dd data-testid="diag-loss">{formatDecimal(conn.stats().lossPct, 1)} %</dd>
              </div>
              <Show when={conn.stats().rssi !== undefined}>
                <div>
                  <dt>{t('conn.diag.rssi')}</dt>
                  <dd data-testid="diag-rssi">{formatInteger(conn.stats().rssi ?? 0)}</dd>
                </div>
              </Show>
              <div>
                <dt>{t('conn.diag.signed')}</dt>
                <dd data-testid="diag-signed">
                  {conn.stats().signed ? t('conn.yes') : t('conn.no')}
                </dd>
              </div>
              <div>
                <dt>{t('conn.diag.bytesIn')}</dt>
                <dd data-testid="diag-bytes-in">{formatInteger(conn.stats().bytesIn)}</dd>
              </div>
              <div>
                <dt>{t('conn.diag.bytesOut')}</dt>
                <dd data-testid="diag-bytes-out">{formatInteger(conn.stats().bytesOut)}</dd>
              </div>
              <div>
                <dt>{t('conn.diag.packets')}</dt>
                <dd data-testid="diag-packets">{formatInteger(conn.stats().packetsIn)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </Show>
  );
};
