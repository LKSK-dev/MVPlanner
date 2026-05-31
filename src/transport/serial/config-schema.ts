/**
 * Connection-UI descriptor for the Serial transport (T1.6; spec plan/03 §3.5
 * item 1). `TransportFactory.configSchema` is typed `unknown` in the frozen
 * contract, so this is a small, self-describing JSON-ish shape the connection
 * drawer (T1.10) reads to render a baud-rate picker. `label` strings are field
 * keys, not rendered copy — the UI localizes them via the i18n catalog
 * (conventions plan/implementation/00 §0.3).
 */

import { DEFAULT_BAUD_RATE, SUPPORTED_BAUD_RATES } from './types';

/** A single selectable option in a {@link SerialConfigField}. */
export interface SerialConfigOption {
  readonly value: number;
  readonly label: string;
}

/** One form control in {@link SerialConfigSchema}. */
export interface SerialConfigField {
  readonly key: string;
  readonly type: 'select';
  readonly label: string;
  readonly default: number;
  readonly options: readonly SerialConfigOption[];
}

/** The Serial transport's connection-form descriptor. */
export interface SerialConfigSchema {
  readonly id: 'serial';
  readonly fields: readonly SerialConfigField[];
}

/** Frozen config-schema instance exposed by the factory. */
export const SERIAL_CONFIG_SCHEMA: SerialConfigSchema = {
  id: 'serial',
  fields: [
    {
      key: 'baudRate',
      type: 'select',
      label: 'transport.serial.baudRate',
      default: DEFAULT_BAUD_RATE,
      options: SUPPORTED_BAUD_RATES.map((value) => ({ value, label: String(value) })),
    },
  ],
};
