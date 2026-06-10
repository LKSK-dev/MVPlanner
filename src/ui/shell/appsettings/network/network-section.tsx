/**
 * Settings → Network: egress transparency (task T8.12; spec plan/07 §7.7,
 * plan/08 §8.3).
 *
 * A read-only list of every network destination the app can reach — there is no
 * analytics and nothing phones home (stated prominently). It surfaces:
 *  - the configured map-tile host (from `store.settings.mapSource`, reactive),
 *  - active ws/wss bridge / WebRTC endpoints (injected `links` accessor),
 *  - extension `net:<host>` grants (injected async `netGrants` loader),
 *  - a live egress log (the broker `recordEgress` sink, via {@link EgressLog})
 *    with a clear-log control.
 *
 * Every data source is injected so the section unit-tests without a live
 * connection / extension system. Mounted inside the App Settings pane's
 * General section.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import type { JSX } from 'solid-js';
import type { AppState, Store } from '../../../../contracts';
import type { TFn } from '../../../../core/i18n';
import type { EgressEntry, EgressLog } from './egress-log';
// The shared `mvp-settings__*` styles (previously loaded transitively via the
// removed legacy SettingsScreen; this section is now their only consumer).
import './settings.css';

export type { TFn };

/** An active link destination (a connected ws/wss bridge or WebRTC endpoint). */
export interface LinkDestination {
  /** Transport kind label (e.g. `websocket`, `webrtc`). */
  readonly kind: string;
  /** Human-readable endpoint (host or URL) when known. */
  readonly label: string;
}

/** An extension `net:<host>` grant row. */
export interface NetGrantRow {
  /** The extension id. */
  readonly extId: string;
  /** The granted host scope (e.g. `example.com` or `*`). */
  readonly host: string;
}

/** Injected data sources for the Network section. */
export interface NetworkSectionDeps {
  /** Live egress log (the broker `recordEgress` sink). */
  readonly egress: EgressLog;
  /** Active link destinations (ws/wss/WebRTC); optional. */
  readonly links?: Accessor<readonly LinkDestination[]>;
  /** Async loader for extension `net:<host>` grants; optional. */
  readonly netGrants?: () => Promise<readonly NetGrantRow[]>;
}

/** {@link NetworkSection} props. */
export interface NetworkSectionProps {
  /** The shared app store (map source, reactive). */
  readonly store: Store<AppState>;
  /** Injected network data sources. */
  readonly deps: NetworkSectionDeps;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Parse the host out of a tile URL template (ignores `{z}/{x}/{y}` tokens). */
function tileHost(urlTemplate: string | undefined): string | undefined {
  if (urlTemplate === undefined || urlTemplate === '') return undefined;
  try {
    return new URL(urlTemplate).host;
  } catch {
    // Template may contain `{...}` placeholders the URL parser rejects; fall
    // back to a best-effort host extraction from the scheme-authority prefix.
    const m = urlTemplate.match(/^[a-z]+:\/\/([^/?#]+)/iu);
    return m?.[1];
  }
}

/** The Settings → Network egress-transparency section. */
export function NetworkSection(props: NetworkSectionProps): JSX.Element {
  const t = props.t;
  const settings = props.store.select((s) => s.settings);

  const mapHost = createMemo<string | undefined>(() => tileHost(settings().mapSource?.urlTemplate));
  const links = createMemo<readonly LinkDestination[]>(() => props.deps.links?.() ?? []);

  const [grants, setGrants] = createSignal<readonly NetGrantRow[]>([]);
  const [egress, setEgress] = createSignal<readonly EgressEntry[]>(props.deps.egress.list());

  const refreshGrants = async (): Promise<void> => {
    const loader = props.deps.netGrants;
    if (loader === undefined) return;
    setGrants(await loader());
  };

  onMount(() => {
    const off = props.deps.egress.subscribe(() => setEgress(props.deps.egress.list()));
    onCleanup(off);
    void refreshGrants();
  });

  const onClearLog = (): void => {
    props.deps.egress.clear();
    setEgress(props.deps.egress.list());
  };

  const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString();

  return (
    <section class="mvp-settings__section" aria-label={t('settings.network.label')}>
      <h2 class="mvp-settings__heading">{t('settings.network.label')}</h2>

      <p class="mvp-settings__hint" data-testid="network-no-phone-home">
        {t('settings.network.noPhoneHome')}
      </p>

      {/* Map tile host -------------------------------------------------- */}
      <h3 class="mvp-settings__subheading">{t('settings.network.map.label')}</h3>
      <ul class="mvp-settings__namespaces" data-testid="network-map">
        <Show
          when={mapHost() !== undefined}
          fallback={<li class="mvp-settings__hint">{t('settings.network.map.default')}</li>}
        >
          <li class="mvp-settings__namespace">
            <span class="mvp-settings__namespace-name">{mapHost()}</span>
          </li>
        </Show>
      </ul>

      {/* Active links --------------------------------------------------- */}
      <h3 class="mvp-settings__subheading">{t('settings.network.links.label')}</h3>
      <ul class="mvp-settings__namespaces" data-testid="network-links">
        <Show
          when={links().length > 0}
          fallback={<li class="mvp-settings__hint">{t('settings.network.links.none')}</li>}
        >
          <For each={links()}>
            {(link) => (
              <li class="mvp-settings__namespace">
                <span class="mvp-settings__namespace-name">{link.label}</span>
                <span class="mvp-settings__namespace-detail">{link.kind}</span>
              </li>
            )}
          </For>
        </Show>
      </ul>

      {/* Extension net: grants ----------------------------------------- */}
      <h3 class="mvp-settings__subheading">{t('settings.network.grants.label')}</h3>
      <ul class="mvp-settings__namespaces" data-testid="network-grants">
        <Show
          when={grants().length > 0}
          fallback={<li class="mvp-settings__hint">{t('settings.network.grants.none')}</li>}
        >
          <For each={grants()}>
            {(row) => (
              <li class="mvp-settings__namespace">
                <span class="mvp-settings__namespace-name">{row.host}</span>
                <span class="mvp-settings__namespace-detail">
                  {t('settings.network.grants.by', { ext: row.extId })}
                </span>
              </li>
            )}
          </For>
        </Show>
      </ul>

      {/* Live egress log ------------------------------------------------ */}
      <div class="mvp-settings__subheading-row">
        <h3 class="mvp-settings__subheading">{t('settings.network.egress.label')}</h3>
        <button
          type="button"
          class="mvp-settings__btn"
          data-testid="network-clear-egress"
          disabled={egress().length === 0}
          onClick={onClearLog}
        >
          {t('settings.network.egress.clear')}
        </button>
      </div>
      <ul class="mvp-settings__namespaces" data-testid="network-egress">
        <Show
          when={egress().length > 0}
          fallback={<li class="mvp-settings__hint">{t('settings.network.egress.empty')}</li>}
        >
          <For each={egress()}>
            {(entry) => (
              <li class="mvp-settings__namespace" data-egress-host={entry.host}>
                <span class="mvp-settings__namespace-name">{entry.host}</span>
                <span class="mvp-settings__namespace-detail">
                  {t('settings.network.egress.row', { ext: entry.extId, time: fmtTime(entry.at) })}
                </span>
              </li>
            )}
          </For>
        </Show>
      </ul>
    </section>
  );
}
