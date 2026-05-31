/**
 * Instruments rail container (task T2.2; spec plan/04 §4.2, plan/05 §5.4 Flight).
 *
 * A thin container that renders a configurable {@link InstrumentPanelProps.selection}
 * of gauges from the {@link GAUGES} registry, threading the same reactive
 * accessors into each. The Flight screen (T2.11) owns where this docks and which
 * selection is persisted; this widget only fans the sources out to the gauges.
 */
import { For, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { resolveSelection } from './registry';
import { metricUnits, type UnitHook } from './units';
import type { GaugeProps, NavProgress, RcState, TFn } from './types';
import type { LinkStats, VehicleState } from '../../../contracts';

/** {@link InstrumentPanel} props. */
export interface InstrumentPanelProps {
  /** Reactive accessor for the active vehicle's derived state. */
  vehicle: () => VehicleState | undefined;
  /** Reactive accessor for link stats; defaults to `vehicle().link` per gauge. */
  link?: () => LinkStats | undefined;
  /** Reactive accessor for RC channels. */
  rc?: () => RcState | undefined;
  /** Reactive accessor for active-mission progress. */
  nav?: () => NavProgress | undefined;
  /** i18n translate function. */
  t: TFn;
  /** Unit-conversion hook; defaults to {@link metricUnits}. */
  units?: UnitHook;
  /** Ordered gauge ids to show; omit to show every registered gauge. */
  selection?: readonly string[];
}

/** Configurable rail of instrument gauges bound to shared reactive sources. */
export const InstrumentPanel: Component<InstrumentPanelProps> = (props) => {
  const gaugeProps = (): GaugeProps => {
    const p: GaugeProps = {
      vehicle: props.vehicle,
      t: props.t,
      units: props.units ?? metricUnits,
    };
    if (props.link !== undefined) p.link = props.link;
    if (props.rc !== undefined) p.rc = props.rc;
    if (props.nav !== undefined) p.nav = props.nav;
    return p;
  };

  return (
    <div class="mvp-gauges" role="group" aria-label={props.t('gauges.panel.label')}>
      <For each={resolveSelection(props.selection)}>
        {(d) => <Dynamic component={d.component} {...gaugeProps()} />}
      </For>
    </div>
  );
};
