import { describe, it, expect, vi } from 'vitest';
import {
  applyPreset,
  createPresetStore,
  diffToWrites,
  loadParamFile,
  parseParamFile,
  saveParamFile,
  serializeParamFile,
  PRESET_INDEX_KEY,
  type ParamFileEntry,
  type Preset,
} from '../../src/data/paramfile';
import type { FileIo } from '../../src/contracts';
import { fakeKv } from '../helpers';

// ---------------------------------------------------------------------------
// parseParamFile
// ---------------------------------------------------------------------------

describe('parseParamFile', () => {
  it('parses comma, space, and tab separators', () => {
    const text = ['A_COMMA,1', 'B_SPACE 2.5', 'C_TAB\t-3'].join('\n');
    expect(parseParamFile(text)).toEqual([
      { name: 'A_COMMA', value: 1 },
      { name: 'B_SPACE', value: 2.5 },
      { name: 'C_TAB', value: -3 },
    ]);
  });

  it('skips blank lines and # / // comments (whole-line and inline)', () => {
    const text = [
      '# a banner comment',
      '',
      '   ',
      '// another comment',
      'ATC_RAT_RLL_P,0.135   # roll rate P',
      'ATC_RAT_RLL_I 0.135 // inline slash',
      '\t',
    ].join('\n');
    expect(parseParamFile(text)).toEqual([
      { name: 'ATC_RAT_RLL_P', value: 0.135 },
      { name: 'ATC_RAT_RLL_I', value: 0.135 },
    ]);
  });

  it('drops a non-numeric header row and ignores trailing columns', () => {
    const text = ['Name,Value', 'WPNAV_SPEED,500,extra,cols', 'FRAME_CLASS 1 99'].join('\n');
    expect(parseParamFile(text)).toEqual([
      { name: 'WPNAV_SPEED', value: 500 },
      { name: 'FRAME_CLASS', value: 1 },
    ]);
  });

  it('handles CRLF/CR line endings and robust number formats', () => {
    const text = 'INT,7\r\nFLOAT,1.0\rEXP,1e-3\r\nNEG,-0.5\r\nHEX,0x10';
    expect(parseParamFile(text)).toEqual([
      { name: 'INT', value: 7 },
      { name: 'FLOAT', value: 1 },
      { name: 'EXP', value: 0.001 },
      { name: 'NEG', value: -0.5 },
      { name: 'HEX', value: 16 },
    ]);
  });

  it('skips lines without a value and NaN/Infinity values', () => {
    const text = ['LONELY_NAME', 'BAD,notanumber', 'INF,Infinity', 'OK,1'].join('\n');
    expect(parseParamFile(text)).toEqual([{ name: 'OK', value: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// serializeParamFile + round-trip
// ---------------------------------------------------------------------------

describe('serializeParamFile', () => {
  it('emits a header, sorts by name, and uses NAME,VALUE lines', () => {
    const text = serializeParamFile([
      { name: 'ZZZ', value: 2 },
      { name: 'AAA', value: 1.25 },
    ]);
    const lines = text.split('\n');
    expect(lines[0]?.startsWith('#')).toBe(true);
    expect(lines[1]).toBe('AAA,1.25');
    expect(lines[2]).toBe('ZZZ,2');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('round-trips serialize -> parse (order-independent)', () => {
    const params: ParamFileEntry[] = [
      { name: 'ATC_RAT_RLL_P', value: 0.135 },
      { name: 'WPNAV_SPEED', value: 500 },
      { name: 'INS_GYRO_FILTER', value: 20 },
      { name: 'COMPASS_OFS_X', value: -12.5 },
      { name: 'BATT_CAPACITY', value: 5200 },
    ];
    const reparsed = parseParamFile(serializeParamFile(params));
    const byName = (e: ParamFileEntry): string => e.name;
    expect([...reparsed].sort((a, b) => byName(a).localeCompare(byName(b)))).toEqual(
      [...params].sort((a, b) => byName(a).localeCompare(byName(b))),
    );
  });

  it('accepts a live Param[] (extra fields) structurally', () => {
    const live = [
      { name: 'B', value: 2, type: 9 },
      { name: 'A', value: 1, type: 9 },
    ];
    expect(serializeParamFile(live)).toBe('# Onboard parameters saved by MVPlanner\nA,1\nB,2\n');
  });
});

// ---------------------------------------------------------------------------
// Preset store
// ---------------------------------------------------------------------------

describe('createPresetStore', () => {
  it('saves, lists, gets, and removes presets', async () => {
    const store = createPresetStore(fakeKv());
    expect(await store.list()).toEqual([]);
    expect(await store.get('missing')).toBeUndefined();

    const gentle: Preset = { name: 'gentle', description: 'soft', params: { ATC_RAT_RLL_P: 0.1 } };
    const sporty: Preset = { name: 'sporty', params: { ATC_RAT_RLL_P: 0.2 } };
    await store.save(gentle);
    await store.save(sporty);

    expect(await store.get('gentle')).toEqual(gentle);
    const names = (await store.list()).map((p) => p.name).sort();
    expect(names).toEqual(['gentle', 'sporty']);

    await store.remove('gentle');
    expect(await store.get('gentle')).toBeUndefined();
    expect((await store.list()).map((p) => p.name)).toEqual(['sporty']);
  });

  it('replacing a preset does not duplicate the index entry', async () => {
    const store = createPresetStore(fakeKv());
    await store.save({ name: 'p', params: { A: 1 } });
    await store.save({ name: 'p', params: { A: 2 } });
    expect((await store.list()).length).toBe(1);
    expect(await store.get('p')).toEqual({ name: 'p', params: { A: 2 } });
  });

  it('rejects empty and reserved preset names', async () => {
    const store = createPresetStore(fakeKv());
    await expect(store.save({ name: '', params: {} })).rejects.toThrow();
    await expect(store.save({ name: PRESET_INDEX_KEY, params: {} })).rejects.toThrow();
  });

  it('remove is a no-op for unknown names', async () => {
    const store = createPresetStore(fakeKv());
    await store.save({ name: 'p', params: { A: 1 } });
    await store.remove('unknown');
    expect((await store.list()).map((p) => p.name)).toEqual(['p']);
  });
});

// ---------------------------------------------------------------------------
// applyPreset + diffToWrites
// ---------------------------------------------------------------------------

describe('applyPreset', () => {
  const preset: Preset = {
    name: 'mix',
    params: { CHANGED: 2, UNCHANGED: 5, ADDED: 9 },
  };

  it('classifies added / changed / unchanged against a Param[]', () => {
    const current: ParamFileEntry[] = [
      { name: 'CHANGED', value: 1 },
      { name: 'UNCHANGED', value: 5 },
    ];
    const diff = applyPreset(preset, current);
    expect(diff.changes).toEqual([
      { name: 'ADDED', to: 9, kind: 'added' },
      { name: 'CHANGED', from: 1, to: 2, kind: 'changed' },
      { name: 'UNCHANGED', from: 5, to: 5, kind: 'unchanged' },
    ]);
  });

  it('works with a Record<string, number> current snapshot', () => {
    const diff = applyPreset(preset, { CHANGED: 1, UNCHANGED: 5 });
    const kinds = Object.fromEntries(diff.changes.map((c) => [c.name, c.kind]));
    expect(kinds).toEqual({ ADDED: 'added', CHANGED: 'changed', UNCHANGED: 'unchanged' });
  });

  it('added entries omit `from`', () => {
    const diff = applyPreset({ name: 'x', params: { NEW: 1 } }, {});
    expect(diff.changes[0]).toEqual({ name: 'NEW', to: 1, kind: 'added' });
    expect('from' in (diff.changes[0] ?? {})).toBe(false);
  });

  it('diffToWrites keeps only added + changed', () => {
    const diff = applyPreset(preset, { CHANGED: 1, UNCHANGED: 5 });
    expect(diffToWrites(diff)).toEqual([
      { name: 'ADDED', value: 9 },
      { name: 'CHANGED', value: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// FileIo load/save
// ---------------------------------------------------------------------------

describe('loadParamFile / saveParamFile', () => {
  it('loads and parses a picked file', async () => {
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => ({
        name: 'copter.param',
        blob: new Blob(['A,1\nB,2\n'], { type: 'text/plain' }),
      })),
      saveAs: vi.fn(async () => undefined),
    };
    const loaded = await loadParamFile(fileIo);
    expect(loaded).toEqual({
      name: 'copter.param',
      params: [
        { name: 'A', value: 1 },
        { name: 'B', value: 2 },
      ],
    });
    expect(fileIo.openForRead).toHaveBeenCalledWith(['.param', '.parm']);
  });

  it('returns undefined when the picker is cancelled', async () => {
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => undefined),
      saveAs: vi.fn(async () => undefined),
    };
    expect(await loadParamFile(fileIo)).toBeUndefined();
  });

  it('serializes and saves with the suggested name', async () => {
    let saved: { text: string; name: string } | undefined;
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => undefined),
      saveAs: vi.fn(async (data: Blob, name: string) => {
        saved = { text: await data.text(), name };
      }),
    };
    await saveParamFile(
      fileIo,
      [
        { name: 'B', value: 2 },
        { name: 'A', value: 1 },
      ],
      'out.param',
    );
    expect(saved?.name).toBe('out.param');
    expect(saved?.text).toBe('# Onboard parameters saved by MVPlanner\nA,1\nB,2\n');
    // saved text re-parses back to the input set.
    expect(parseParamFile(saved?.text ?? '')).toEqual([
      { name: 'A', value: 1 },
      { name: 'B', value: 2 },
    ]);
  });

  it('uses the default file name when none is given', async () => {
    let name = '';
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => undefined),
      saveAs: vi.fn(async (_data: Blob, n: string) => {
        name = n;
      }),
    };
    await saveParamFile(fileIo, [{ name: 'A', value: 1 }]);
    expect(name).toBe('params.param');
  });
});
