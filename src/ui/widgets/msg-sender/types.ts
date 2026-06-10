/**
 * Public types for the metadata-driven MAVLink message / MAV_CMD sender widget.
 *
 * The sender is intentionally host-agnostic: callers inject a structural
 * `send(name, fields, options)` seam that can be backed by `MavlinkHost` or by a
 * test double. The widget only imports dialect metadata and pure derivation
 * helpers.
 */
import type { DialectTable, EnumEntryMeta, FieldMeta, MessageMeta } from '../../../contracts';
import type { TFn } from '../../../core/i18n';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type { TFn };

/** Optional per-send flags supported by the sender seam. */
export interface MsgSenderSendOptions {
  /** Request MAVLink v2 signing for this transmission when the host supports it. */
  readonly signed?: boolean;
}

/** Host/transport seam used by {@link MessageSender}. */
export type MsgSenderSend = (
  name: string,
  fields: Record<string, unknown>,
  options?: MsgSenderSendOptions,
) => void | Promise<void>;

/** A persisted named field preset. */
export interface MsgSenderFavorite {
  /** Stable favorite id. */
  readonly id: string;
  /** User-facing preset name. */
  readonly name: string;
  /** Selection id this preset applies to (`message:<dialect>:<name>` or `command:<value>`). */
  readonly selectionId: string;
  /** Raw editor values as entered in the UI. */
  readonly values: Readonly<Record<string, string>>;
  /** Command send flavor captured with command presets. */
  readonly commandWire?: CommandWire;
  /** Per-send signing state captured with the preset. */
  readonly signed?: boolean;
}

/** Optional persistence seam for favorites. */
export interface MsgSenderFavoriteStore {
  /** Load stored favorites. Called once on mount. */
  load: () => readonly MsgSenderFavorite[] | Promise<readonly MsgSenderFavorite[]>;
  /** Persist the full favorite list after a save. */
  save: (favorites: readonly MsgSenderFavorite[]) => void | Promise<void>;
}

/** How a `MAV_CMD` is encoded on send. */
export type CommandWire = 'long' | 'int';

/** Picker entry for either a concrete MAVLink message or a `MAV_CMD` enum entry. */
export type SenderChoice = MessageChoice | CommandChoice;

/** Picker entry for a MAVLink message. */
export interface MessageChoice {
  readonly kind: 'message';
  readonly id: string;
  readonly label: string;
  readonly searchText: string;
  readonly dialect: DialectTable;
  readonly meta: MessageMeta;
}

/** Picker entry for a MAV_CMD enum entry. */
export interface CommandChoice {
  readonly kind: 'command';
  readonly id: string;
  readonly label: string;
  readonly searchText: string;
  readonly dialect: DialectTable;
  readonly entry: EnumEntryMeta;
}

/** An enum option rendered by a dropdown editor. */
export interface FieldEnumOption {
  readonly value: number;
  readonly name: string;
  readonly description?: string;
}

/** Type-aware editor field resolved from dialect metadata. */
export interface FieldEditorSpec {
  /** Field key used in the raw values map and eventual MAVLink fields. */
  readonly name: string;
  /** Human label shown next to the editor. */
  readonly label: string;
  /** MAVLink field type (or `float` for command parameter slots). */
  readonly type: string;
  /** Original message field metadata when this spec came from a message. */
  readonly field?: FieldMeta;
  /** Array length for comma-separated array editors. */
  readonly arrayLen?: number;
  /** Units suffix from dialect metadata, when available. */
  readonly units?: string;
  /** Enum name for dropdown editors. */
  readonly enumName?: string;
  /** Dropdown entries resolved from the active dialect. */
  readonly enumOptions?: readonly FieldEnumOption[];
  /** True for char arrays, which edit as a plain string instead of comma values. */
  readonly textArray?: boolean;
  /** True when a MAV_CMD slot is not labelled by dialect metadata. */
  readonly unused?: boolean;
}

/** Props for the message / command sender widget. */
export interface MessageSenderProps {
  /** Encode + send a message out the active link. */
  readonly send: MsgSenderSend;
  /** i18n translate function. */
  readonly t: TFn;
  /** Dialects to expose (defaults to the built-in tables). */
  readonly dialects?: readonly DialectTable[];
  /** Target system used for COMMAND_LONG / COMMAND_INT (default `1`). */
  readonly targetSystem?: number;
  /** Target component used for COMMAND_LONG / COMMAND_INT (default `1`). */
  readonly targetComponent?: number;
  /** Optional favorite persistence seam. */
  readonly favorites?: MsgSenderFavoriteStore;
}
