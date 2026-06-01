/**
 * `ui/widgets/msg-sender` public surface (T6.8; spec plan/04 §4.9).
 *
 * A developer power-tool widget for sending arbitrary MAVLink messages and
 * `MAV_CMD`s from dialect metadata. Consumers inject the active link's send seam;
 * this package derives editors and favorite presets without importing a host
 * singleton.
 *
 * @see ./README.md for the API contract and testing notes.
 */
import './messages';

export { MessageSender, MessageSender as MsgSender } from './msg-sender';
export {
  buildSenderChoices,
  buildMessageChoices,
  buildCommandChoices,
  commandFieldSpecs,
  defaultRawValue,
  defaultRawValues,
  enumOptionLabel,
  filterSenderChoices,
  inferCommandParamEnum,
  messageFieldSpecs,
  parseFieldValue,
  parseMessageFields,
} from './derive';
export { registerMsgSenderMessages, MSG_SENDER_MESSAGES } from './messages';
export type {
  CommandChoice,
  CommandWire,
  FieldEditorSpec,
  FieldEnumOption,
  MessageChoice,
  MessageSenderProps,
  MsgSenderFavorite,
  MsgSenderFavoriteStore,
  MsgSenderSend,
  MsgSenderSendOptions,
  SenderChoice,
  TFn,
} from './types';
