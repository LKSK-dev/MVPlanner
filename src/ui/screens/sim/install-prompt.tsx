/**
 * Install-time permission prompt UI (M7 assembly; task T7.2, spec plan/06
 * §6.3/§6.5).
 *
 * {@link createInstallPromptController} owns a serialized queue of pending
 * prompts and exposes a {@link GrantPrompt} that the permission flow
 * ({@link import('../../../ext/permissions').requestGrants}) calls on install /
 * enable. {@link InstallPromptHost} renders the head of the queue as a modal that
 * lists each requested permission (high-risk flagged), pre-checked, with
 * Approve-selected / Deny-all actions — so the operator can approve a narrowed
 * subset. Resolving advances the queue.
 *
 * The host is rendered once at the app root so prompts work regardless of which
 * screen is mounted.
 */
import { For, Show, createEffect, createSignal, type Accessor, type Component } from 'solid-js';
import type { ExtManifest, Permission } from '../../../contracts';
import type { GrantPrompt, PermissionRequest } from '../../../ext/permissions';
import { describePermissionRequests } from '../../../ext/permissions';
import './messages';

/** i18n translate fn (matches the shell's `t`). */
export type TFn = (k: string, vars?: Record<string, string | number>) => string;

/** A queued prompt awaiting operator resolution. */
interface PromptRequest {
  readonly id: number;
  readonly manifest: ExtManifest;
  readonly requests: readonly PermissionRequest[];
  readonly resolve: (perms: readonly Permission[]) => void;
}

/** The install-prompt controller: a {@link GrantPrompt} + the reactive head. */
export interface InstallPromptController {
  /** The injectable prompt the permission flow calls. */
  readonly prompt: GrantPrompt;
  /** The pending prompt at the head of the queue (or `undefined`). */
  readonly pending: Accessor<PromptRequest | undefined>;
}

/** Build a serialized {@link InstallPromptController}. */
export function createInstallPromptController(): InstallPromptController {
  const [queue, setQueue] = createSignal<readonly PromptRequest[]>([]);
  let nextId = 1;

  const prompt: GrantPrompt = (manifest, requests) =>
    new Promise<readonly Permission[]>((resolve) => {
      const id = nextId++;
      const settle = (perms: readonly Permission[]): void => {
        resolve(perms);
        setQueue((q) => q.filter((r) => r.id !== id));
      };
      setQueue((q) => [...q, { id, manifest, requests, resolve: settle }]);
    });

  return { prompt, pending: () => queue()[0] };
}

/** Props for {@link InstallPromptHost}. */
export interface InstallPromptHostProps {
  /** The controller whose head this host renders. */
  readonly controller: InstallPromptController;
  /** i18n translate fn. */
  readonly t: TFn;
}

/** Modal host rendering the head of the install-prompt queue. */
export const InstallPromptHost: Component<InstallPromptHostProps> = (props) => {
  const t = props.t;
  const [checked, setChecked] = createSignal<ReadonlySet<Permission>>(new Set<Permission>());

  // Reset the checked set (all pre-checked) whenever a new prompt surfaces.
  createEffect(() => {
    const head = props.controller.pending();
    if (head === undefined) return;
    setChecked(new Set<Permission>(head.requests.map((r) => r.permission)));
  });

  const toggle = (perm: Permission, on: boolean): void => {
    setChecked((prev) => {
      const next = new Set<Permission>(prev);
      if (on) next.add(perm);
      else next.delete(perm);
      return next;
    });
  };

  return (
    <Show when={props.controller.pending()}>
      {(req) => (
        <div class="mvp-extprompt" role="dialog" aria-modal="true" data-testid="install-prompt">
          <div class="mvp-extprompt__card">
            <h2 class="mvp-extprompt__title">
              {t('extprompt.title', { name: req().manifest.name })}
            </h2>
            <Show
              when={req().requests.length > 0}
              fallback={<p class="mvp-extprompt__body">{t('extprompt.none')}</p>}
            >
              <p class="mvp-extprompt__body">{t('extprompt.body')}</p>
              <ul class="mvp-extprompt__perms">
                <For each={req().requests}>
                  {(request) => (
                    <li class="mvp-extprompt__perm" classList={{ 'is-risk': request.highRisk }}>
                      <label class="mvp-extprompt__perm-label">
                        <input
                          type="checkbox"
                          checked={checked().has(request.permission)}
                          onChange={(e) => {
                            toggle(request.permission, e.currentTarget.checked);
                          }}
                        />
                        <code>{request.permission}</code>
                      </label>
                      <Show when={request.highRisk}>
                        <span class="mvp-extprompt__risk">{t('extprompt.highRisk')}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="mvp-extprompt__actions">
              <button
                type="button"
                class="mvp-extprompt__deny"
                onClick={() => {
                  req().resolve([]);
                }}
              >
                {t('extprompt.deny')}
              </button>
              <button
                type="button"
                class="mvp-extprompt__approve"
                data-testid="install-prompt-approve"
                onClick={() => {
                  const selected = req()
                    .requests.map((r) => r.permission)
                    .filter((p) => checked().has(p));
                  req().resolve(selected);
                }}
              >
                {t('extprompt.approve')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

/** Re-export so consumers can annotate a manifest's requests if needed. */
export { describePermissionRequests };
