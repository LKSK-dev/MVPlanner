/**
 * Shared pointer-drag lifecycle helper (refactor: canonical implementation —
 * replaces the duplicated window-listener wiring in the dock resize gutter and
 * the ResizableSplit widget).
 *
 * Captures the pointer, attaches window `pointermove`/`pointerup`/
 * `pointercancel` listeners, and guarantees teardown: the returned `end`
 * function detaches everything (call it from `onCleanup` so a mid-drag unmount
 * can never leak listeners).
 */

/** Handlers for {@link beginPointerDrag}. */
export interface PointerDragHandlers {
  /** Called for every pointer move while the drag is active. */
  readonly onMove: (ev: PointerEvent) => void;
  /** Called once when the drag ends (pointerup/pointercancel/manual end). */
  readonly onEnd?: () => void;
}

/**
 * Start a drag from a `pointerdown` event. Returns the `end` function (also
 * invoked automatically on pointerup/pointercancel); calling it again is a
 * no-op, so it is safe to register with `onCleanup`.
 */
export function beginPointerDrag(e: PointerEvent, handlers: PointerDragHandlers): () => void {
  const target = e.currentTarget as HTMLElement | null;
  const pointerId = e.pointerId;
  target?.setPointerCapture?.(pointerId);

  let ended = false;
  const move = (ev: PointerEvent): void => {
    if (!ended) handlers.onMove(ev);
  };
  const end = (): void => {
    if (ended) return;
    ended = true;
    target?.releasePointerCapture?.(pointerId);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    handlers.onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  return end;
}
