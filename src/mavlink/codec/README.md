# `src/mavlink/codec` — MAVLink v1/v2 codec (task T1.1)

Pure, dependency-free TypeScript implementation of MAVLink framing, behind the
frozen `MavCodec` / `MavParser` / `DecodedMessage` contracts in
`src/contracts/mavlink.ts`. Spec: `plan/03` §3.1–§3.2; conventions `plan/implementation/00` §0.3.

## What it does

- **v1 (`0xFE`) and v2 (`0xFD`) framing** — encode + streaming decode.
- **CRC-16/MCRF4XX** (`crc.ts`) seeded with the per-message `crcExtra` from the
  dialect table; little-endian on the wire.
- **v2 payload truncation** on encode (trailing zero bytes trimmed, ≥1 kept) and
  **zero-fill** back to the full field set on decode.
- **Extension fields** — included in v2, omitted from v1 (and from `crcExtra`,
  which is precomputed in the table).
- **24-bit message ids**, incompat/compat flags.
- **v2 message signing** (`signing.ts`, `sha256.ts`) — `link_id(1) |
timestamp(6, LE 48-bit) | sig(6)`, `sig = SHA-256(key‖frame‖link_id‖timestamp)[0:6]`;
  verify on decode, optional per-(link, sysid, compid) timestamp monotonicity,
  `allowUnsigned` policy.
- **Resync-safe parser** (`parser.ts`) — buffers across `push()` calls, never
  throws on garbage, scans past false magic bytes, drops bad-CRC / bad-signature
  frames.
- **Typed fields** — 64-bit ints → `bigint`, `char[]` → `string` (NUL-trimmed),
  numeric arrays → `number[]`, floats per IEEE-754 (incl. NaN/Inf).

## Owned files

| File             | Responsibility                                       |
| ---------------- | ---------------------------------------------------- |
| `crc.ts`         | CRC-16/MCRF4XX accumulation.                         |
| `sha256.ts`      | Tiny synchronous SHA-256 over `Uint8Array`.          |
| `field-codec.ts` | Per-field + payload pack/unpack, type table.         |
| `signing.ts`     | Signature compute/verify, timestamps, signing state. |
| `encode.ts`      | Frame serialization (`encodeFrame`).                 |
| `parser.ts`      | `StreamingParser` (resync-safe `push`).              |
| `codec.ts`       | `createMavCodec` — the `MavCodec` factory.           |
| `index.ts`       | Public barrel.                                       |

## Usage

```ts
import { createMavCodec } from '@/mavlink/codec';
import { BUILTIN_DIALECTS } from '@/mavlink/dialects';

const codec = createMavCodec({ dialects: BUILTIN_DIALECTS });

// encode
const frame = codec.encode(
  {
    name: 'HEARTBEAT',
    sysid: 1,
    compid: 1,
    fields: {
      type: 2,
      autopilot: 3,
      base_mode: 81,
      custom_mode: 0,
      system_status: 4,
      mavlink_version: 3,
    },
  },
  { version: 2 },
);

// decode (streaming)
const parser = codec.parser({ dialects: BUILTIN_DIALECTS });
for (const msg of parser.push(frame)) {
  console.log(msg.name, msg.fields);
}
```

### Contract-additive options

The frozen `MessageInput` has no `seq` and the frozen `SigningConfig` has no
outgoing timestamp, so `encode` accepts two **optional, additive** fields — `seq`
and `timestamp` — used for deterministic output (e.g. conformance vectors). When
omitted, `seq` auto-increments and the signing timestamp comes from the wall
clock. The parser accepts an additive `enforceTimestampMonotonic` flag. None of
these change the `MavCodec` surface.

## Tests

- `test/unit/vectors-conformance.test.ts` — byte-for-byte encode/decode against
  the independent pymavlink reference vectors (`test/vectors/**`, task T1.3).
- `test/unit/codec-parser.test.ts` — resync/fuzz, split frames, corrupt CRC,
  byte-by-byte feeding, signing accept/reject + monotonicity.
- `test/unit/codec-encode.test.ts` — truncation/zero-fill, extensions, 64-bit.
- `test/unit/codec-primitives.test.ts` — CRC + SHA-256 known-answer tests.

```sh
export npm_config_cache="$PWD/.npm-cache"
npm run typecheck && npm test
```

## Known upstream defect (NOT in this module)

The generated dialect tables (`src/mavlink/dialects/generated/*.json`, task T1.2)
misattribute `arrayLen` for 90 messages / 224 fields: `array_lengths` was indexed
by XML field order instead of wire (`ordered_fieldnames`) order. Within the
shipped conformance set this only hits **`PARAM_VALUE`** (`param_id` should be
`char[16]`; `param_count` should be a scalar `uint16`). The codec is correct; the
table is wrong. The conformance test runs those cases under `it.fails` so they
are documented (not hidden) and will become hard failures the moment the dialect
generator is fixed and the tables regenerated.
