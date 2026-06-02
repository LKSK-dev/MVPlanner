/**
 * App Settings → Extensions section (spec docs/appsettings; extension manager in
 * the pane). Renders the existing {@link ExtensionsManager} bound to the SAME
 * {@link ExtensionsController} the Sim & Dev Tools hub drives, so installs,
 * enable/disable, reload, uninstall and permission grants/revokes stay in sync
 * across both surfaces. When no extension system is wired (isolated tests / a
 * mock host) it shows an unavailable hint.
 */
import { Show, createComponent, type Component } from 'solid-js';
import type { AppSettingsSectionDeps } from '../context';
import { ExtensionsManager } from '../../../screens/sim';
import '../../../screens/sim/extensions-manager.css';

/** The Extensions manager, embedded in the App Settings pane. */
export const ExtensionsSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const t = props.deps.t;
  return (
    <Show
      when={props.deps.extensions}
      fallback={
        <p class="mvp-appsettings__hint" data-testid="appsettings-extensions-unavailable">
          {t('appsettings.extensions.unavailable')}
        </p>
      }
    >
      {(controller) => createComponent(ExtensionsManager, { controller: controller(), t })}
    </Show>
  );
};
