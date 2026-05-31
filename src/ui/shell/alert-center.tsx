/**
 * Alert center: a toast stack with an ARIA live region plus a modal confirm
 * dialog (T0.7; spec plan/05 §5.7, contract `src/contracts/ui.ts`
 * {@link ConfirmOptions}).
 *
 * Toasts announce via `aria-live`; errors use `role="alert"` (assertive),
 * info/warn use `role="status"` (polite). The confirm dialog backs
 * {@link UiRegistry.confirm} and is reused later for destructive vehicle
 * actions; `armedAware` strengthens the copy when an active vehicle is armed
 * (spec plan/08 §8.3).
 */
import { For, Show, onCleanup, onMount, type Component } from 'solid-js';
import { t } from '../../core/i18n';
import { useShell } from './context';

/** True when any known vehicle is currently armed (best-effort, M0). */
function anyArmed(vehicles: Record<number, { armed: boolean }>): boolean {
  return Object.values(vehicles).some((v) => v.armed);
}

/** Toast stack + confirm modal, mounted once at the shell root. */
export const AlertCenter: Component = () => {
  const { registry, store } = useShell();

  return (
    <>
      <div class="mvp-toasts" role="region" aria-label={t('a11y.notifications')}>
        <For each={registry.toasts()}>
          {(toast) => (
            <div
              class="mvp-toast"
              classList={{
                'mvp-toast--info': toast.kind === 'info',
                'mvp-toast--warn': toast.kind === 'warn',
                'mvp-toast--error': toast.kind === 'error',
              }}
              role={toast.kind === 'error' ? 'alert' : 'status'}
            >
              <span class="mvp-toast__msg">{toast.msg}</span>
              <button
                type="button"
                class="mvp-toast__close"
                aria-label={t('toast.dismiss')}
                onClick={() => registry.dismissToast(toast.id)}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>

      <Show when={registry.confirmRequest()}>
        {(request) => {
          const opts = request().opts;
          const armed = opts.armedAware === true && anyArmed(store.get().vehicles);
          let dialogEl: HTMLDivElement | undefined;
          let cancelEl: HTMLButtonElement | undefined;
          let confirmEl: HTMLButtonElement | undefined;

          // Capture the previously-focused element and move focus into the
          // dialog; restore it on resolve/unmount so the modal is a true
          // keyboard trap with no focus leak.
          const previouslyFocused = document.activeElement as HTMLElement | null;
          onMount(() => {
            queueMicrotask(() => (cancelEl ?? dialogEl)?.focus());
          });
          onCleanup(() => previouslyFocused?.focus?.());

          const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
              e.preventDefault();
              request().resolve(false);
              return;
            }
            if (e.key !== 'Tab') return;
            // Trap Tab/Shift+Tab between Cancel and Confirm.
            const focusables = [cancelEl, confirmEl].filter(
              (el): el is HTMLButtonElement => el != null,
            );
            if (focusables.length === 0) return;
            const first = focusables[0]!;
            const last = focusables[focusables.length - 1]!;
            const current = document.activeElement;
            e.preventDefault();
            if (e.shiftKey) {
              (current === first ? last : first).focus();
            } else {
              (current === last ? first : last).focus();
            }
          };

          return (
            <div class="mvp-modal-backdrop" onClick={() => request().resolve(false)}>
              <div
                ref={dialogEl}
                class="mvp-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="mvp-confirm-title"
                aria-describedby="mvp-confirm-body"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={onKeyDown}
              >
                <h2 class="mvp-modal__title" id="mvp-confirm-title">
                  {opts.title}
                </h2>
                <p class="mvp-modal__body" id="mvp-confirm-body">
                  {opts.body}
                </p>
                <Show when={armed}>
                  <p class="mvp-modal__warn" role="note">
                    {t('confirm.armedWarning')}
                  </p>
                </Show>
                <div class="mvp-modal__actions">
                  <button
                    ref={cancelEl}
                    type="button"
                    class="mvp-btn"
                    onClick={() => request().resolve(false)}
                  >
                    {t('confirm.cancel')}
                  </button>
                  <button
                    ref={confirmEl}
                    type="button"
                    class="mvp-btn mvp-btn--primary"
                    classList={{ 'mvp-btn--danger': opts.destructive === true }}
                    onClick={() => request().resolve(true)}
                  >
                    {t('confirm.confirm')}
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </>
  );
};
