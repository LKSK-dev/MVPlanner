/**
 * Pure derivation tests for the MAVLink message / command sender.
 *
 * Covers the metadata-only contract: message fields become typed editor specs,
 * enum dropdowns are populated from the active dialect, MAV_CMD parameter labels
 * are applied, and known command parameter enums are inferred.
 */
import { describe, expect, it } from 'vitest';
import type { DialectTable, EnumEntryMeta } from '../../src/contracts';
import {
  buildSenderChoices,
  commandFieldSpecs,
  messageFieldSpecs,
  parseMessageFields,
} from '../../src/ui/widgets/msg-sender';

const DO_CHANGE_SPEED: EnumEntryMeta = {
  value: 178,
  name: 'MAV_CMD_DO_CHANGE_SPEED',
  params: ['Speed Type', 'Speed', 'Throttle', 'Relative', '', '', ''],
};

const TEST_DIALECT: DialectTable = {
  name: 'test',
  messages: {
    0: {
      id: 0,
      name: 'HEARTBEAT',
      crcExtra: 50,
      fields: [
        { name: 'custom_mode', type: 'uint32_t' },
        { name: 'type', type: 'uint8_t', enum: 'MAV_TYPE' },
        { name: 'label', type: 'char', arrayLen: 8 },
        { name: 'rates', type: 'float', arrayLen: 3, units: 'm/s' },
      ],
    },
  },
  enums: {
    MAV_TYPE: [
      { value: 1, name: 'MAV_TYPE_FIXED_WING' },
      { value: 2, name: 'MAV_TYPE_QUADROTOR' },
    ],
    MAV_CMD: [DO_CHANGE_SPEED],
    SPEED_TYPE: [
      { value: 0, name: 'SPEED_TYPE_AIRSPEED' },
      { value: 1, name: 'SPEED_TYPE_GROUNDSPEED' },
    ],
  },
};

function requireSpec(name: string) {
  const message = TEST_DIALECT.messages[0];
  if (message === undefined) throw new Error('missing test message');
  const spec = messageFieldSpecs(TEST_DIALECT, message).find((item) => item.name === name);
  if (spec === undefined) throw new Error(`missing spec ${name}`);
  return spec;
}

describe('msg-sender derivation', () => {
  it('derives message field editors with enum options, arrays, and units', () => {
    const type = requireSpec('type');
    expect(type.enumName).toBe('MAV_TYPE');
    expect(type.enumOptions?.map((option) => option.name)).toEqual([
      'MAV_TYPE_FIXED_WING',
      'MAV_TYPE_QUADROTOR',
    ]);

    const label = requireSpec('label');
    expect(label.textArray).toBe(true);
    expect(label.arrayLen).toBe(8);

    const rates = requireSpec('rates');
    expect(rates.arrayLen).toBe(3);
    expect(rates.units).toBe('m/s');
  });

  it('parses message values according to derived specs', () => {
    const message = TEST_DIALECT.messages[0];
    if (message === undefined) throw new Error('missing test message');
    const fields = parseMessageFields(messageFieldSpecs(TEST_DIALECT, message), {
      custom_mode: '42',
      type: '2',
      label: 'abc',
      rates: '1.5, 2.5',
    });
    expect(fields).toEqual({ custom_mode: 42, type: 2, label: 'abc', rates: [1.5, 2.5, 0] });
  });

  it('derives MAV_CMD labels and known enum-valued params', () => {
    const specs = commandFieldSpecs(TEST_DIALECT, DO_CHANGE_SPEED);
    const names = specs.map((spec) => spec.name);
    expect(names).toContain('param1');
    expect(names).toContain('x');
    expect(names).toContain('z');

    const speedType = specs.find((spec) => spec.name === 'param1');
    expect(speedType?.label).toBe('Speed Type');
    expect(speedType?.enumName).toBe('SPEED_TYPE');
    expect(speedType?.enumOptions?.map((option) => option.name)).toContain(
      'SPEED_TYPE_GROUNDSPEED',
    );

    const param5 = specs.find((spec) => spec.name === 'param5');
    expect(param5?.unused).toBe(true);
  });

  it('builds searchable message and command picker choices', () => {
    const choices = buildSenderChoices([TEST_DIALECT]);
    expect(choices.some((choice) => choice.id === 'message:test:HEARTBEAT')).toBe(true);
    expect(choices.some((choice) => choice.id === 'command:178')).toBe(true);
  });
});
