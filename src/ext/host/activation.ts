/**
 * Activation events (task T7.1; spec plan/06 §6.3).
 *
 * Extensions activate **lazily**: the host fires named events and activates an
 * enabled extension the first time one of its events matches. Because the frozen
 * {@link ExtManifest} has no `activationEvents` field, the host owns this
 * metadata — either supplied explicitly at install or derived from the
 * manifest's `contributes` (a contributed command -> `onCommand:<id>`).
 */
import type { ExtManifest } from '../../contracts';

/** The activation-event vocabulary the host fires (spec plan/06 §6.3). */
export type ActivationEvent =
  | 'onStartup'
  | 'onConnect'
  | `onScreen:${string}`
  | `onCommand:${string}`
  | `onMessage:${string}`;

/**
 * Default activation events when none are declared:
 * - one `onCommand:<id>` per contributed command (lazy on palette/command use),
 * - `onStartup` when panels are contributed (so the panel is registered eagerly),
 * - falling back to `onStartup` when nothing else is derivable.
 */
export function deriveActivationEvents(manifest: ExtManifest): ActivationEvent[] {
  const events = new Set<ActivationEvent>();
  for (const cmd of manifest.contributes?.commands ?? []) {
    events.add(`onCommand:${cmd.id}`);
  }
  if ((manifest.contributes?.panels?.length ?? 0) > 0) {
    events.add('onStartup');
  }
  if (events.size === 0) events.add('onStartup');
  return [...events];
}
