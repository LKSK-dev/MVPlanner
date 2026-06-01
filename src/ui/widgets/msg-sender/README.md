# MAVLink message sender widget (T6.8)

Developer power-tool for sending arbitrary MAVLink messages and `MAV_CMD`s from
bundled (or injected) dialect metadata.

## API

```ts
<MessageSender
  t={t}
  dialects={BUILTIN_DIALECTS}
  send={(name, fields, options) => host.sendMessage(name, fields)}
/>
```

The widget intentionally depends on a structural send seam:

```ts
type MsgSenderSend = (
  name: string,
  fields: Record<string, unknown>,
  options?: { signed?: boolean },
) => void | Promise<void>;
```

`options.signed` is passed through for hosts that support per-send signing. The
current `MavlinkHost.sendMessage(name, fields)` can be adapted by ignoring the
third argument until the host grows that capability.

## Metadata derivation

- Message editors come from `MessageMeta.fields`:
  - numeric MAVLink types render number inputs;
  - enum fields use dropdowns from `dialect.enums[field.enum]`;
  - arrays render comma-separated inputs, except `char[]`, which renders text;
  - field units are shown when `FieldMeta.units` is present.
- Command editors come from `dialect.enums.MAV_CMD` entries:
  - `param1..param7` plus `x/y/z` are labelled from `EnumEntryMeta.params`;
  - known enum-valued slots (for example `MAV_FRAME`, `SPEED_TYPE`,
    `CAMERA_MODE`) render dropdowns when the dialect exposes the enum;
  - `COMMAND_LONG` and `COMMAND_INT` send paths are available.

Favorites are held in memory and can be persisted through the optional
`MsgSenderFavoriteStore` hook (`load`/`save` of the complete favorite list).

The rate control uses `StreamRateService` to emit `COMMAND_LONG` carrying
`MAV_CMD_SET_MESSAGE_INTERVAL` for the selected message id.

## Tests

- `test/unit/msg-sender-derive.test.ts` covers pure editor derivation.
- `test/unit/msg-sender-widget.test.ts` mounts the Solid component with a mock
  sender and asserts message send, command send, and enum dropdown behavior.
