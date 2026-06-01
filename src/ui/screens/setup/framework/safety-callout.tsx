/**
 * Safety / info callout banner for the Setup wizard framework (task T5.2; spec
 * plan/05 §5.4 "clear 'what this does / safety' callouts").
 *
 * A small, theme-token-driven banner rendered above a step's guided content. It
 * is a presentational `role="note"` region with a non-color status cue (icon)
 * alongside the kind colour, satisfying the non-color-cue a11y rule
 * (plan/05 §5.8).
 */
import { type Component } from 'solid-js';
import type { TFn } from './types';

/** Callout flavour: a `'safety'` warning or a neutral `'info'` explainer. */
export type SafetyCalloutKind = 'safety' | 'info';

/** {@link SafetyCallout} props. */
export interface SafetyCalloutProps {
  /** The callout body text (already localized by the caller). */
  note: string;
  /** i18n translate function (for the default heading). */
  t: TFn;
  /** Callout flavour; defaults to `'safety'`. */
  kind?: SafetyCalloutKind;
  /** Optional heading override; defaults to the kind's standard heading. */
  title?: string;
}

/** A "what this does / safety" callout banner. */
export const SafetyCallout: Component<SafetyCalloutProps> = (props) => {
  const kind = (): SafetyCalloutKind => props.kind ?? 'safety';
  const heading = (): string =>
    props.title ?? props.t(kind() === 'safety' ? 'setup.safety.title' : 'setup.info.title');

  return (
    <aside class="mvp-setup-callout" data-kind={kind()} role="note" aria-label={heading()}>
      <span class="mvp-setup-callout__icon" aria-hidden="true">
        {kind() === 'safety' ? '\u26A0' : '\u2139'}
      </span>
      <div class="mvp-setup-callout__body">
        <span class="mvp-setup-callout__title">{heading()}</span>
        <p class="mvp-setup-callout__note">{props.note}</p>
      </div>
    </aside>
  );
};
