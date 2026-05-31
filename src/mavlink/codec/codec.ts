/**
 * {@link MavCodec} implementation (spec plan/03 §3.2).
 *
 * `encode` looks a message up by name across the configured dialect tables and
 * serializes it; `parser` builds a streaming, resync-safe {@link MavParser}.
 *
 * The frozen `MessageInput` carries no sequence number and the frozen
 * `SigningConfig` carries no outgoing timestamp, so this factory accepts them
 * as additive, optional encode options (`seq`, `timestamp`) — keeping the
 * `MavCodec` surface intact while allowing deterministic output (used by the
 * pymavlink conformance vectors). When omitted, `seq` auto-increments per link
 * and the signing timestamp comes from the wall clock.
 */
import type {
  DialectTable,
  MavCodec,
  MavParser,
  MessageInput,
  MessageMeta,
  SigningConfig,
} from '../../contracts';
import { type EncodeFrameOptions, type FrameSigning, encodeFrame } from './encode';
import { MavCodecError } from './field-codec';
import { type ParserExtras, StreamingParser } from './parser';
import { SigningState, signingTimestampNow } from './signing';

/** Encode options: the frozen `{version, signing?}` plus additive determinism knobs. */
export interface EncodeOptions {
  version: 1 | 2;
  signing?: SigningConfig;
  /** Override the per-link auto-incrementing sequence number. */
  seq?: number;
  /** Override the outgoing 48-bit signing timestamp (10µs ticks since 2015-01-01). */
  timestamp?: bigint;
}

/** Parser options: the frozen `{dialects, signing?}` plus {@link ParserExtras}. */
export type ParserOptions = {
  dialects: readonly DialectTable[];
  signing?: SigningConfig;
} & ParserExtras;

/** Concrete codec: a {@link MavCodec} with the additive encode/parser options. */
export interface Codec extends MavCodec {
  encode(input: MessageInput, opts: EncodeOptions): Uint8Array;
  parser(opts: ParserOptions): MavParser;
}

/** Configuration for {@link createMavCodec}. */
export interface CodecConfig {
  /** Dialect tables consulted by `encode` (by message name). */
  dialects: readonly DialectTable[];
  /** Outgoing signing-timestamp source (defaults to the wall clock). */
  signingTimestamp?: () => bigint;
}

/**
 * Create a codec bound to `config.dialects`.
 */
export function createMavCodec(config: CodecConfig): Codec {
  const nameIndex = new Map<string, MessageMeta>();
  for (const dialect of config.dialects) {
    for (const meta of Object.values(dialect.messages)) {
      if (!nameIndex.has(meta.name)) nameIndex.set(meta.name, meta);
    }
  }

  const clock = config.signingTimestamp ?? signingTimestampNow;
  const signingState = new SigningState();
  let txSeq = 0;

  return {
    encode(input: MessageInput, opts: EncodeOptions): Uint8Array {
      const meta = nameIndex.get(input.name);
      if (meta === undefined) {
        throw new MavCodecError(`unknown message: ${input.name}`);
      }

      let seq: number;
      if (opts.seq !== undefined) {
        seq = opts.seq & 0xff;
      } else {
        seq = txSeq;
        txSeq = (txSeq + 1) & 0xff;
      }

      const frameOpts: EncodeFrameOptions = { version: opts.version, seq };
      if (opts.version === 2 && opts.signing?.enabled && opts.signing.key) {
        const timestamp = opts.timestamp ?? signingState.nextTxTimestamp(clock());
        const signing: FrameSigning = {
          key: opts.signing.key,
          linkId: opts.signing.linkId ?? 0,
          timestamp,
        };
        frameOpts.signing = signing;
      }

      return encodeFrame(meta, input, frameOpts);
    },

    parser(opts: ParserOptions): MavParser {
      return new StreamingParser(opts.dialects, opts.signing, {
        enforceTimestampMonotonic: opts.enforceTimestampMonotonic ?? false,
      });
    },
  };
}
