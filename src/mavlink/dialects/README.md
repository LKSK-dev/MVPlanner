# MAVLink dialect tables (T1.2)

Generated, compact dialect tables consumed by the codec (T1.1) and the
inspector / command sender / mission editors for enum + MAV_CMD metadata.

## Contract

Each table is a frozen `DialectTable` (`src/contracts/mavlink.ts`):

```
DialectTable  = { name, messages: Record<id, MessageMeta>, enums: Record<name, EnumEntryMeta[]> }
MessageMeta   = { id, name, crcExtra, fields: FieldMeta[], extensionIndex? }
FieldMeta     = { name, type, arrayLen?, enum?, units? }
EnumEntryMeta = { value, name, description?, params? }
```

- `fields` are in MAVLink **wire order** (pymavlink `ordered_fieldnames`).
- `type` is the canonical MAVLink type string (`uint8_t`, `int32_t`, `float`,
  `double`, `char`, `uint64_t`, …); array length is carried separately as
  `arrayLen`.
- `extensionIndex` is the wire-order index at which v2 **extension** fields
  begin (omitted for messages without extensions).
- `params` are MAV_CMD param labels (positional, 1-based → array index 0-based).

## Owned files

- `generated/<dialect>.json` — committed compact tables (no pretty-print
  whitespace; size budget per spec plan/08 §8.1).
- `index.ts` — typed exports: `commonDialect`, `ardupilotmegaDialect`,
  `BUILTIN_DIALECTS`.

`ardupilotmega` is the superset (it bundles the common/standard/minimal include
chain); `common` is the lighter default.

## Regenerating

Uses the project venv's pinned pymavlink (do **not** `pip install`):

```sh
./.venv/bin/python scripts/gen-dialects.py                 # common + ardupilotmega
./.venv/bin/python scripts/gen-dialects.py development      # add more, no code edits
```

A dialect name works if it resolves as both `pymavlink.dialects.v20.<name>` and
`message_definitions/v1.0/<name>.xml`. After adding a new committed JSON, export
it from `index.ts` and add it to `BUILTIN_DIALECTS`.

## Testing

`test/unit/dialects.test.ts` asserts known-good ground-truth values (e.g.
HEARTBEAT crcExtra, wire field order, a known extension boundary) so a pymavlink
bump or generator regression is caught in CI.
