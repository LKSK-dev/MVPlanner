/**
 * Shared dialog focus-trap helper (refactor: canonical implementation —
 * replaced 4 duplicated Tab-wrap blocks in alert-center, command-palette, the
 * App Settings pane and the connection drawer).
 *
 * Call from a dialog's `onKeyDown`: when the event is a Tab press it wraps
 * focus between the first and last focusable descendants of `container`
 * (Shift+Tab wraps backwards) and prevents the default move, keeping keyboard
 * focus inside the `aria-modal` surface.
 */

/** Selector matching the focusable elements a trap cycles through. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Trap a Tab keydown inside `container`. No-op for non-Tab keys, a missing
 * container, or a container with no focusable children.
 */
export function trapTabKey(e: KeyboardEvent, container: HTMLElement | undefined | null): void {
  if (e.key !== 'Tab' || !container) return;
  const focusables = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) return;
  const current = document.activeElement;
  if (e.shiftKey) {
    if (current === first || current === container) {
      e.preventDefault();
      last.focus();
    }
  } else if (current === last) {
    e.preventDefault();
    first.focus();
  }
}
