/** Unit tests for data export utilities (T6.7). */
import { describe, expect, it, vi } from 'vitest';
import type { FileIo, MessageInput } from '../../src/contracts';
import { createMavCodec } from '../../src/mavlink/codec';
import { BUILTIN_DIALECTS } from '../../src/mavlink/dialects';
import {
  extractMessageStream,
  listTlogMessageTypes,
  saveCsv,
  seriesToCsv,
  tlogToCsv,
} from '../../src/data/export';

/** Concatenate timestamped MAVLink frames into a tlog byte stream. */
function buildTlog(entries: readonly { ticks: bigint; frame: Uint8Array }[]): Uint8Array {
  const total = entries.reduce((sum, entry) => sum + 8 + entry.frame.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let offset = 0;
  for (const entry of entries) {
    view.setBigUint64(offset, entry.ticks, false);
    offset += 8;
    out.set(entry.frame, offset);
    offset += entry.frame.byteLength;
  }
  return out;
}

/** Build a small valid tlog with two decoded MAVLink message types. */
function syntheticTlog(): Uint8Array {
  const codec = createMavCodec({ dialects: BUILTIN_DIALECTS });
  const systemTime: MessageInput = {
    name: 'SYSTEM_TIME',
    sysid: 1,
    compid: 1,
    fields: { time_unix_usec: 123456789n, time_boot_ms: 42 },
  };
  const heartbeat: MessageInput = {
    name: 'HEARTBEAT',
    sysid: 1,
    compid: 1,
    fields: {
      custom_mode: 3,
      type: 2,
      autopilot: 3,
      base_mode: 81,
      system_status: 4,
      mavlink_version: 3,
    },
  };

  return buildTlog([
    { ticks: 100000n, frame: codec.encode(systemTime, { version: 2, seq: 10 }) },
    { ticks: 120000n, frame: codec.encode(heartbeat, { version: 2, seq: 11 }) },
  ]);
}

describe('seriesToCsv', () => {
  it('writes inferred headers, plain numbers, and quoted escaped text fields', () => {
    const csv = seriesToCsv([
      { time: 0, altitude: 12.5, note: 'hello, "world"' },
      { time: 1000000, altitude: -3, note: 'line\nbreak' },
    ]);

    expect(csv).toBe(
      'time,altitude,note\n' + '0,12.5,"hello, ""world"""\n' + '1000000,-3,"line\nbreak"\n',
    );
  });

  it('honors an explicit column spec and leaves nullish cells empty', () => {
    const csv = seriesToCsv(
      [
        { t: 1, value: 7, ignored: 'x' },
        { t: 2, value: null, ignored: 'y' },
      ],
      [
        { header: 'time,s', value: 't' },
        {
          header: 'double',
          value: (row) => (typeof row.value === 'number' ? row.value * 2 : row.value),
        },
      ],
    );

    expect(csv).toBe('"time,s",double\n1,14\n2,\n');
  });
});

describe('tlog CSV conversion', () => {
  it('extracts decoded messages with tlog timestamps', () => {
    const messages = [...extractMessageStream(syntheticTlog())];

    expect(messages.map((item) => item.message.name)).toEqual(['SYSTEM_TIME', 'HEARTBEAT']);
    expect(messages.map((item) => item.timeUs)).toEqual([0, 2000]);
    expect(messages[0]?.timeTicks).toBe(100000n);
    expect(messages[0]?.message.fields.time_boot_ms).toBe(42);
  });

  it('lists present message names and observed fields', () => {
    const types = listTlogMessageTypes(syntheticTlog());
    const systemTime = types.find((type) => type.name === 'SYSTEM_TIME');
    const heartbeat = types.find((type) => type.name === 'HEARTBEAT');

    expect(systemTime?.fields).toEqual(['time_unix_usec', 'time_boot_ms']);
    expect(systemTime?.count).toBe(1);
    expect(heartbeat?.fields).toEqual([
      'custom_mode',
      'type',
      'autopilot',
      'base_mode',
      'system_status',
      'mavlink_version',
    ]);
  });

  it('exports one CSV per message type with fields and timestamps', () => {
    const files = tlogToCsv(syntheticTlog());
    const systemTime = files.find((file) => file.messageName === 'SYSTEM_TIME');
    const heartbeat = files.find((file) => file.messageName === 'HEARTBEAT');

    expect(systemTime?.name).toBe('SYSTEM_TIME.csv');
    expect(systemTime?.csv).toBe(
      'time_us,time_ticks,sysid,compid,seq,time_unix_usec,time_boot_ms\n' +
        '0,100000,1,1,10,123456789,42\n',
    );
    expect(heartbeat?.csv).toContain('2000,120000,1,1,11,3,2,3,81,4,3\n');
  });

  it('exports a flattened selected-field CSV', () => {
    const csv = tlogToCsv(syntheticTlog(), {
      mode: 'flat',
      fields: [
        'SYSTEM_TIME.time_boot_ms',
        { message: 'HEARTBEAT', field: 'system_status', header: 'status' },
      ],
    });

    expect(csv).toBe(
      'time_us,time_ticks,message,SYSTEM_TIME.time_boot_ms,status\n' +
        '0,100000,SYSTEM_TIME,42,\n' +
        '2000,120000,HEARTBEAT,,4\n',
    );
  });
});

describe('saveCsv', () => {
  it('saves CSV text through FileIo', async () => {
    const saveAs = vi.fn<FileIo['saveAs']>(async () => undefined);
    const fileIo: FileIo = {
      openForRead: async () => undefined,
      saveAs,
    };

    await saveCsv(fileIo, 'series.csv', 'a,b\n1,2\n');

    expect(saveAs).toHaveBeenCalledOnce();
    const [blob, suggestedName] = saveAs.mock.calls[0] ?? [];
    expect(suggestedName).toBe('series.csv');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    expect(await blob?.text()).toBe('a,b\n1,2\n');
  });
});
