# `data/paramfile` — parameter file I/O + presets

Task **T3.5** (spec `plan/04` §4.5, `plan/07` §7.6). Read/write Mission-Planner /
MAVProxy `.param`/`.parm` files and manage **named partial presets** with a
non-destructive apply/diff preview. Built on the storage foundation
(`data/storage` `KvStore` + `FileIo`, T0.9).

## Parameter file format

A `.param`/`.parm` file is plain text, one parameter per line. All of these are
accepted (auto-detected per line):

```
NAME,VALUE
NAME VALUE
NAME<TAB>VALUE
```

The parser is deliberately tolerant:

- blank lines are skipped;
- `#…` and `//…` comments are skipped, both whole-line and trailing/inline
  (e.g. `ATC_RAT_RLL_P,0.135   # roll rate P`);
- any **extra trailing columns** are ignored (`NAME,VALUE,extra`);
- a row whose value is **non-numeric** is treated as a header/banner and dropped
  (so a `Name,Value` CSV header or an MP banner line needs no configuration);
- `\n`, `\r\n`, and `\r` line endings all work.

```ts
import { parseParamFile, serializeParamFile } from '@/data/paramfile';

const entries = parseParamFile(text); // { name: string; value: number }[]
const text2 = serializeParamFile(entries); // MP-compatible, sorted by name
```

`serializeParamFile` emits a leading `# Onboard parameters saved by MVPlanner`
header comment then one `NAME,VALUE` line per parameter, **sorted by name**
(ASCII). Values use the shortest round-trippable decimal, so
`parseParamFile(serializeParamFile(x))` returns `x` (order-independent).

A live `Param[]` (from the param microservice) is structurally assignable to
`ParamFileEntry[]`, so it can be serialized directly.

## Presets (named partial sets)

A `Preset = { name; description?; params: Record<string, number> }` is a JSON,
**partial** parameter set persisted in a `KvStore` namespace (default
`param-presets`). Because `KvStore` has no enumeration primitive, the store keeps
its own name index under a reserved key.

```ts
import { createPresetStore, applyPreset, diffToWrites } from '@/data/paramfile';

const presets = createPresetStore(kv);
await presets.save({ name: 'gentle', params: { ATC_RAT_RLL_P: 0.1 } });
await presets.list(); // Preset[]
await presets.get('gentle');
await presets.remove('gentle');
```

### Apply = preview, then write

`applyPreset` **never writes** — it returns a diff so the UI can confirm first:

```ts
const diff = applyPreset(preset, current); // current: Param[] | Record<string, number>
// diff.changes: { name, from?, to, kind: 'added' | 'changed' | 'unchanged' }[]
const writes = diffToWrites(diff); // only added + changed → { name, value }[]
for (const w of writes) await paramClient.set(w.name, w.value);
```

`from` is omitted when the parameter is absent from `current` (`kind: 'added'`).
Changes are sorted by name.

## Disk load/save

`FileIo`-based adapters the Config assembly wires to the workbench
`onLoad`/`onSave`:

```ts
import { loadParamFile, saveParamFile } from '@/data/paramfile';

const loaded = await loadParamFile(fileIo); // { name, params } | undefined (cancel)
await saveParamFile(fileIo, params, 'copter.param');
```

## Owned files

- `parse.ts` — `parseParamFile` / `serializeParamFile` (pure, format logic).
- `presets.ts` — `createPresetStore`, `applyPreset`, `diffToWrites`.
- `fileio.ts` — `loadParamFile` / `saveParamFile` over `FileIo`.
- `types.ts` — `ParamFileEntry`, `Preset`, `PresetDiff`, `PresetStore`, …
- `index.ts` — public barrel.

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/paramfile.test.ts
npx eslint src/data/paramfile test/unit/paramfile.test.ts
```

Tests cover comma/space/tab parsing, comments + headers + trailing columns, the
serialize→parse round-trip, preset save/list/get/remove via a fake `KvStore`,
the apply diff (added/changed/unchanged) for both `current` shapes, and the
`FileIo` load/save pair against a mock `FileIo`.
