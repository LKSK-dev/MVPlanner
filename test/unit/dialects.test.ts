import { describe, it, expect } from 'vitest';
import type { DialectTable, EnumEntryMeta, MessageMeta } from '../../src/contracts';
import { ardupilotmegaDialect, BUILTIN_DIALECTS, commonDialect } from '../../src/mavlink/dialects';

// These assertions pin known-good MAVLink ground truth so a pymavlink bump or a
// generator regression (wrong CRC_EXTRA, wire-order, or extension boundary)
// fails loudly in CI instead of silently shipping a broken codec table.

function fieldNames(msg: MessageMeta): string[] {
  return msg.fields.map((f) => f.name);
}

function requireMsg(table: DialectTable, id: number): MessageMeta {
  const msg = table.messages[id];
  if (!msg) throw new Error(`missing message id ${id} in ${table.name}`);
  return msg;
}

function findEnumEntry(table: DialectTable, enumName: string, value: number): EnumEntryMeta {
  const entry = table.enums[enumName]?.find((e) => e.value === value);
  if (!entry) throw new Error(`missing ${enumName}=${value} in ${table.name}`);
  return entry;
}

describe('generated dialect tables', () => {
  it('exposes the built-in dialects', () => {
    expect(commonDialect.name).toBe('common');
    expect(ardupilotmegaDialect.name).toBe('ardupilotmega');
    expect(BUILTIN_DIALECTS).toEqual([commonDialect, ardupilotmegaDialect]);
  });

  it('ardupilotmega is the superset of common', () => {
    const commonCount = Object.keys(commonDialect.messages).length;
    const arduCount = Object.keys(ardupilotmegaDialect.messages).length;
    expect(arduCount).toBeGreaterThan(commonCount);
    // Every common message id must also exist in ardupilotmega.
    for (const id of Object.keys(commonDialect.messages)) {
      expect(ardupilotmegaDialect.messages[Number(id)]).toBeDefined();
    }
  });

  describe.each([
    ['common', commonDialect],
    ['ardupilotmega', ardupilotmegaDialect],
  ] as const)('%s', (_name, table) => {
    it('HEARTBEAT (id 0): CRC_EXTRA and exact wire field order', () => {
      const hb = requireMsg(table, 0);
      expect(hb.name).toBe('HEARTBEAT');
      expect(hb.crcExtra).toBe(50);
      // pymavlink wire order: custom_mode (u32) is promoted ahead of the u8s.
      expect(fieldNames(hb)).toEqual([
        'custom_mode',
        'type',
        'autopilot',
        'base_mode',
        'system_status',
        'mavlink_version',
      ]);
      // HEARTBEAT has no v2 extension fields.
      expect(hb.extensionIndex).toBeUndefined();
      // Field metadata: enums captured, custom_mode is uint32_t.
      const custom = hb.fields.find((f) => f.name === 'custom_mode');
      expect(custom?.type).toBe('uint32_t');
      expect(hb.fields.find((f) => f.name === 'type')?.enum).toBe('MAV_TYPE');
    });

    it('GPS_RAW_INT (id 24): extension boundary and field metadata', () => {
      const gps = requireMsg(table, 24);
      expect(gps.name).toBe('GPS_RAW_INT');
      expect(gps.crcExtra).toBe(24);
      // 10 base fields then 6 v2 extension fields (alt_ellipsoid … yaw).
      expect(gps.extensionIndex).toBe(10);
      expect(gps.fields.length).toBe(16);
      expect(fieldNames(gps).slice(10)).toEqual([
        'alt_ellipsoid',
        'h_acc',
        'v_acc',
        'vel_acc',
        'hdg_acc',
        'yaw',
      ]);
      // Units + enum metadata are captured per field.
      expect(gps.fields.find((f) => f.name === 'lat')?.units).toBe('degE7');
      expect(gps.fields.find((f) => f.name === 'fix_type')?.enum).toBe('GPS_FIX_TYPE');
    });

    it('GPS_STATUS (id 25): array field length captured', () => {
      const s = requireMsg(table, 25);
      const prn = s.fields.find((f) => f.name === 'satellite_prn');
      expect(prn?.type).toBe('uint8_t');
      expect(prn?.arrayLen).toBe(20);
    });

    it('PARAM_VALUE (id 22): arrayLen keyed by wire order, not declaration', () => {
      // Regression guard for the generator's declaration-vs-wire ordering bug:
      // pymavlink truth is param_id=char[16], param_count=scalar uint16_t.
      const pv = requireMsg(table, 22);
      const paramId = pv.fields.find((f) => f.name === 'param_id');
      expect(paramId?.type).toBe('char');
      expect(paramId?.arrayLen).toBe(16);
      const paramCount = pv.fields.find((f) => f.name === 'param_count');
      expect(paramCount?.type).toBe('uint16_t');
      expect(paramCount?.arrayLen).toBeUndefined();
    });

    it('ATTITUDE_TARGET (id 83): float[4] quaternion array captured', () => {
      const at = requireMsg(table, 83);
      const q = at.fields.find((f) => f.name === 'q');
      expect(q?.type).toBe('float');
      expect(q?.arrayLen).toBe(4);
    });

    it('MAV_CMD metadata: names, descriptions, and param labels', () => {
      const wp = findEnumEntry(table, 'MAV_CMD', 16);
      expect(wp.name).toBe('MAV_CMD_NAV_WAYPOINT');
      expect(wp.description).toBeTruthy();
      expect(wp.params).toEqual([
        'Hold',
        'Accept Radius',
        'Pass Radius',
        'Yaw',
        'Latitude',
        'Longitude',
        'Altitude',
      ]);
    });

    it('enum metadata: plain enum entries and no ENUM_END sentinels', () => {
      const quad = findEnumEntry(table, 'MAV_TYPE', 2);
      expect(quad.name).toBe('MAV_TYPE_QUADROTOR');
      for (const [enumName, entries] of Object.entries(table.enums)) {
        for (const entry of entries) {
          expect(entry.name.endsWith('_ENUM_END'), `${enumName}.${entry.name}`).toBe(false);
        }
      }
    });

    it('every message id key matches its meta id', () => {
      for (const [id, meta] of Object.entries(table.messages)) {
        expect(meta.id).toBe(Number(id));
        expect(meta.fields.length).toBeGreaterThan(0);
        if (meta.extensionIndex !== undefined) {
          expect(meta.extensionIndex).toBeGreaterThan(0);
          expect(meta.extensionIndex).toBeLessThan(meta.fields.length);
        }
      }
    });
  });
});
