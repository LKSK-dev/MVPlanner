/**
 * Extensions manager UI (M7 assembly; spec plan/06 §6.3/§6.5).
 *
 * Lists installed extensions (name / version / status / permissions), with
 * enable / disable / uninstall / reload actions, per-permission revoke, an
 * import button (JSON bundle via {@link FileIo}) and the error/paused state for
 * a faulted extension. All behaviour is delegated to the DOM-free
 * {@link ExtensionsController}; this is a thin reactive view + the
 * {@link createExtensionsManagerPanel} registration glue.
 */
import { For, Show, createComponent, createSignal, type Component } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef, Permission } from '../../../contracts';
import { isHighRiskPermission } from '../../../ext/permissions';
import type { ExtStatus } from '../../../ext/host';
import type { ExtensionsController } from './controller';
import './messages';

/** i18n translate fn (matches the shell's `t`). */
export type TFn = (k: string, vars?: Record<string, string | number>) => string;

/** Stable panel id for the extensions manager. */
export const EXTENSIONS_MANAGER_PANEL_ID = 'ext.manager';
/** Stable command id to reveal the extensions manager. */
export const EXTENSIONS_MANAGER_COMMAND_ID = 'ext.manager.open';

/** Map a host status to its i18n label key. */
function statusKey(status: ExtStatus): string {
  return `extmgr.status.${status}`;
}

/** Props for {@link ExtensionsManager}. */
export interface ExtensionsManagerProps {
  /** The controller driving the list + actions. */
  readonly controller: ExtensionsController;
  /** i18n translate fn. */
  readonly t: TFn;
}

/** The extensions manager view. */
export const ExtensionsManager: Component<ExtensionsManagerProps> = (props) => {
  const t = props.t;
  const grantsFor = (id: string): readonly Permission[] => props.controller.grants().get(id) ?? [];
  // The extension id with an in-flight action; its row's buttons are disabled.
  const [busyId, setBusyId] = createSignal<string | undefined>();
  const runAction = (id: string, action: () => Promise<void>): void => {
    setBusyId(id);
    void action().finally(() => setBusyId((current) => (current === id ? undefined : current)));
  };

  return (
    <section class="mvp-extmgr" data-screen="extensions" aria-label={t('extmgr.title')}>
      <header class="mvp-extmgr__head">
        <h2 class="mvp-extmgr__title">{t('extmgr.title')}</h2>
        <button
          type="button"
          class="mvp-extmgr__install"
          data-testid="extmgr-install"
          onClick={() => {
            void props.controller.installFromFile();
          }}
        >
          {t('extmgr.install')}
        </button>
      </header>

      <Show
        when={props.controller.states().length > 0}
        fallback={<p class="mvp-extmgr__empty">{t('extmgr.empty')}</p>}
      >
        <ul class="mvp-extmgr__list">
          <For each={props.controller.states()}>
            {(ext) => (
              <li class="mvp-extmgr__item" data-ext={ext.id} data-status={ext.status}>
                <div class="mvp-extmgr__row">
                  <div class="mvp-extmgr__meta">
                    <span class="mvp-extmgr__name">{ext.manifest.name}</span>
                    <span class="mvp-extmgr__version">v{ext.manifest.version}</span>
                    <span
                      class="mvp-extmgr__status"
                      classList={{ 'is-error': ext.status === 'error' }}
                      data-testid="ext-status"
                    >
                      {t(statusKey(ext.status))}
                    </span>
                  </div>
                  <div class="mvp-extmgr__actions">
                    <Show
                      when={ext.status === 'active'}
                      fallback={
                        <button
                          type="button"
                          data-testid="ext-enable"
                          disabled={busyId() === ext.id}
                          onClick={() => {
                            runAction(ext.id, () => props.controller.enable(ext.id));
                          }}
                        >
                          {t('extmgr.enable')}
                        </button>
                      }
                    >
                      <button
                        type="button"
                        data-testid="ext-disable"
                        disabled={busyId() === ext.id}
                        onClick={() => {
                          runAction(ext.id, () => props.controller.disable(ext.id));
                        }}
                      >
                        {t('extmgr.disable')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId() === ext.id}
                        onClick={() => {
                          runAction(ext.id, () => props.controller.reload(ext.id));
                        }}
                      >
                        {t('extmgr.reload')}
                      </button>
                    </Show>
                    <button
                      type="button"
                      data-testid="ext-uninstall"
                      disabled={busyId() === ext.id}
                      onClick={() => {
                        runAction(ext.id, () => props.controller.uninstall(ext.id));
                      }}
                    >
                      {t('extmgr.uninstall')}
                    </button>
                  </div>
                </div>

                <Show when={ext.status === 'error' && ext.error !== undefined}>
                  <p class="mvp-extmgr__error" data-testid="ext-error">
                    {ext.error}
                  </p>
                </Show>

                <div class="mvp-extmgr__perms">
                  <span class="mvp-extmgr__perms-label">{t('extmgr.permissions')}</span>
                  <Show
                    when={ext.manifest.permissions.length > 0}
                    fallback={<span class="mvp-extmgr__noperms">{t('extmgr.noPermissions')}</span>}
                  >
                    <ul class="mvp-extmgr__perm-list">
                      <For each={ext.manifest.permissions}>
                        {(perm) => (
                          <li
                            class="mvp-extmgr__perm"
                            classList={{ 'is-risk': isHighRiskPermission(perm) }}
                          >
                            <code>{perm}</code>
                            <Show when={isHighRiskPermission(perm)}>
                              <span class="mvp-extmgr__risk">{t('extmgr.highRisk')}</span>
                            </Show>
                            <Show when={grantsFor(ext.id).includes(perm)}>
                              <span class="mvp-extmgr__granted">{t('extmgr.granted')}</span>
                              <button
                                type="button"
                                class="mvp-extmgr__revoke"
                                aria-label={t('extmgr.revoke', { permission: perm })}
                                disabled={busyId() === ext.id}
                                onClick={() => {
                                  runAction(ext.id, () => props.controller.revoke(ext.id, perm));
                                }}
                              >
                                ×
                              </button>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
};

/** Build the dockable extensions-manager {@link PanelDef}. */
export function createExtensionsManagerPanel(controller: ExtensionsController, t: TFn): PanelDef {
  return {
    id: EXTENSIONS_MANAGER_PANEL_ID,
    title: t('extmgr.panel.label'),
    icon: 'extensions',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(() => createComponent(ExtensionsManager, { controller, t: api.t }), el);
    },
  };
}
