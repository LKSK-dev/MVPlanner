/**
 * DOM value-card gauges (task T2.2; spec plan/04 §4.2, plan/05 §5.5/§5.8).
 *
 * Each card is a `<section>` with a heading and a definition list of labelled
 * readings — fully accessible (label + text value, status conveyed as text +
 * a `data-status` attribute, never color alone). The reading logic is the pure
 * `format.ts` layer; these components only bind the reactive accessors to it.
 */
import { For, Show, type Component } from 'solid-js';
import {
  airspeedReadings,
  batteryReadings,
  ekfReadings,
  gpsReadings,
  linkReadings,
  navReadings,
  rcReadings,
  systemReadings,
  vibeReadings,
} from './format';
import type { GaugeProps, GaugeReading, TFn } from './types';

/** {@link ValueCard} props. */
export interface ValueCardProps {
  /** i18n key for the card title. */
  labelKey: string;
  /** i18n translate function. */
  t: TFn;
  /** Reactive accessor for the rows to render. */
  readings: () => readonly GaugeReading[];
}

/** Render a single reading's value (literal, enum key, or the none placeholder). */
function readingValue(r: GaugeReading, t: TFn): string {
  if (r.valueKey !== undefined) return t(r.valueKey);
  return r.value ?? t('gauges.value.none');
}

/** A labelled, accessible value card used by the non-canvas gauges. */
export const ValueCard: Component<ValueCardProps> = (props) => (
  <section class="mvp-gauge mvp-gauge--card" role="group" aria-label={props.t(props.labelKey)}>
    <h3 class="mvp-gauge__title">{props.t(props.labelKey)}</h3>
    <dl class="mvp-gauge__readings">
      <For each={props.readings()}>
        {(r) => (
          <div class="mvp-gauge__reading" data-status={r.status ?? 'neutral'}>
            <dt class="mvp-gauge__reading-label">{props.t(r.labelKey, r.labelVars)}</dt>
            <dd class="mvp-gauge__reading-value">
              <span class="mvp-gauge__reading-number">{readingValue(r, props.t)}</span>
              <Show when={r.unitKey}>
                {(key) => <span class="mvp-gauge__unit"> {props.t(key())}</span>}
              </Show>
            </dd>
          </div>
        )}
      </For>
    </dl>
  </section>
);

/** Airspeed / groundspeed card. */
export const AirspeedGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.airspeed.title"
    t={props.t}
    readings={(): GaugeReading[] => airspeedReadings(props.vehicle(), props.units)}
  />
);

/** Battery (V / A / remaining %) card. */
export const BatteryGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.battery.title"
    t={props.t}
    readings={(): GaugeReading[] => batteryReadings(props.vehicle())}
  />
);

/** GPS (fix / sats / HDOP) card. */
export const GpsGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.gps.title"
    t={props.t}
    readings={(): GaugeReading[] => gpsReadings(props.vehicle())}
  />
);

/** EKF status card. */
export const EkfGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.ekf.title"
    t={props.t}
    readings={(): GaugeReading[] => ekfReadings(props.vehicle())}
  />
);

/** Vibration card. */
export const VibeGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.vibe.title"
    t={props.t}
    readings={(): GaugeReading[] => vibeReadings(props.vehicle())}
  />
);

/** RC inputs/outputs card (shows an empty state when RC data is absent). */
export const RcGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.rc.title"
    t={props.t}
    readings={(): GaugeReading[] => rcReadings(props.rc?.())}
  />
);

/** System status (armed + mode) card. */
export const SystemGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.system.title"
    t={props.t}
    readings={(): GaugeReading[] => systemReadings(props.vehicle())}
  />
);

/** Link / RSSI card (falls back to the vehicle's embedded link stats). */
export const LinkGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.link.title"
    t={props.t}
    readings={(): GaugeReading[] => linkReadings(props.link?.() ?? props.vehicle()?.link)}
  />
);

/** Current-WP / distance / ETA card. */
export const NavGauge: Component<GaugeProps> = (props) => (
  <ValueCard
    labelKey="gauges.nav.title"
    t={props.t}
    readings={(): GaugeReading[] => navReadings(props.nav?.(), props.units)}
  />
);
