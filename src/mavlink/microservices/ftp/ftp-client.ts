/**
 * {@link FtpClient} — the MAVLink FTP (`FILE_TRANSFER_PROTOCOL`) microservice
 * for directory listing, robust burst/sequential reading, writing, and removal
 * (tasks T3.1 + T5.11; spec plan/03 §3.4 FTP, contract {@link FtpClientApi}).
 *
 * Design (see ./README.md for the full contract):
 *  - Every operation is a sequence of request/response transactions. A request
 *    is one `FILE_TRANSFER_PROTOCOL` with an FTP payload (see
 *    {@link import('./ftp-protocol')}); the server answers with an `Ack` or a
 *    `Nak` carrying the SAME-relationship sequence number (`reply.seq ===
 *    request.seq + 1`). {@link FtpClient.transact} owns one in-flight request at
 *    a time, with a timeout + bounded retry (resending the identical frame) and
 *    an {@link AbortSignal} hook.
 *  - `list(path)` pages `ListDirectory` by entry offset until the server NAKs
 *    `EndOfFile` (or returns an empty page), parsing each NUL-terminated record
 *    (`F<name>\t<size>` / `D<name>` / `S…` skip).
 *  - `read(path)` issues `OpenFileRO` (the Ack carries the file size), prefers
 *    `BurstReadFile` pages (assembling only contiguous offsets and re-requesting
 *    gaps), falls back to sequential `ReadFile`, and always `TerminateSession`s.
 *  - `write(path, data)` issues `CreateFile`, streams `WriteFile` chunks by
 *    offset, and always `TerminateSession`s once a session exists. `remove(path)`
 *    is a single `RemoveFile` transaction.
 *
 * Pure logic: the host seam ({@link FtpSendFn} / {@link FtpMessageTap}), the FTP
 * {@link FtpTarget}, and the {@link FtpClock} are injected, so the client
 * unit-tests against a mock host and a fake clock with no worker.
 */
import type { FtpClient as FtpClientApi, FtpEntry } from '../../../contracts';
import type { DecodedMessage, FieldValue } from '../../../contracts';
import {
  FTP_MAX_DATA,
  FTP_MSG_NAME,
  FtpNak,
  FtpOpcode,
  type FtpPayload,
  decodePayload,
  encodePayload,
  nakName,
  readU32LE,
} from './ftp-protocol';

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type FtpSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type FtpMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** The FTP peer addressed by every request (the vehicle's autopilot component). */
export interface FtpTarget {
  /** `target_network` (almost always 0). */
  readonly network: number;
  /** `target_system` — the vehicle sysid; replies are matched against it. */
  readonly system: number;
  /** `target_component` — the autopilot compid (typically 1). */
  readonly component: number;
}

/**
 * Schedules `handler` after `ms`, returning a cancel function. Abstracted so
 * tests drive retries/timeouts with a deterministic fake clock.
 */
export interface FtpClock {
  setTimeout(handler: () => void, ms: number): () => void;
}

/** Why an {@link FtpError} occurred — drives caller handling / UI. */
export type FtpErrorReason = 'timeout' | 'aborted' | 'nak' | 'send-failed' | 'protocol';

/** A failed FTP operation: carries the {@link FtpErrorReason} and any NAK code. */
export class FtpError extends Error {
  constructor(
    message: string,
    readonly reason: FtpErrorReason,
    /** The {@link FtpNak} code when `reason === 'nak'`. */
    readonly nak?: number,
  ) {
    super(message);
    this.name = 'FtpError';
  }
}

/** Construction dependencies for {@link FtpClient}. */
export interface FtpClientDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: FtpSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: FtpMessageTap;
  /** The FTP peer (network/system/component) every request is addressed to. */
  readonly target: FtpTarget;
  /** Timer source (default: global `setTimeout`/`clearTimeout`). */
  readonly clock?: FtpClock;
  /** Per-request response timeout in ms (default 800). */
  readonly timeoutMs?: number;
  /** Retries after the first attempt before a timeout rejection (default 4). */
  readonly maxRetries?: number;
  /** Bytes requested per `ReadFile` chunk (default {@link FTP_MAX_DATA} = 239). */
  readonly chunkSize?: number;
}

/** One in-flight transaction awaiting its correlated server response. */
interface Pending {
  readonly expectedSeq: number;
  readonly requestOpcode: number;
  readonly session: number;
  readonly burst: boolean;
  highestSeq: number;
  readonly resolve?: (p: FtpPayload) => void;
  readonly onReply?: (p: FtpPayload) => void;
}

/** Result of one `BurstReadFile` request, which may contain many ACK frames. */
interface BurstResult {
  /** ACK frames received for the burst request. */
  readonly frames: FtpPayload[];
  /** Terminal NAK, when the server ended or rejected the burst request. */
  readonly nak?: number;
  /** Whether the server sent an ACK with `burst_complete != 0` or a NAK. */
  readonly complete: boolean;
}

/** Default clock backed by the host environment's timer functions. */
const DEFAULT_CLOCK: FtpClock = {
  setTimeout(handler: () => void, ms: number): () => void {
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  },
};

const EMPTY = new Uint8Array(0);
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const CHAR_FILE = 'F'.charCodeAt(0);
const CHAR_DIR = 'D'.charCodeAt(0);
const SEQ_HALF_RANGE = 0x8000;

/** Return whether `candidate` is at or after `base` in the MAVLink FTP u16 seq space. */
function seqAtOrAfter(base: number, candidate: number): boolean {
  const delta = (candidate - base) & 0xffff;
  return delta < SEQ_HALF_RANGE;
}

/** Return whether `candidate` is ahead of `base` in the MAVLink FTP u16 seq space. */
function seqAfter(base: number, candidate: number): boolean {
  const delta = (candidate - base) & 0xffff;
  return delta > 0 && delta < SEQ_HALF_RANGE;
}

/** Read a `FieldValue` as a `number[]` (the codec shape for u8 arrays). */
function asByteArray(value: FieldValue | undefined): number[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Parse a `ListDirectory` Ack `data` blob into entries plus the raw record
 * count. Records are NUL-terminated `F<name>\t<size>` (file), `D<name>`
 * (directory) or `S…`/other (skip). The count (all records, including skips)
 * is how far the server advanced, so it drives the next page's offset.
 */
function parseListing(data: Uint8Array): { entries: FtpEntry[]; count: number } {
  const entries: FtpEntry[] = [];
  let count = 0;
  let start = 0;
  for (let i = 0; i < data.byteLength; i++) {
    if (data[i] !== 0) continue;
    const rec = data.subarray(start, i);
    start = i + 1;
    count++;
    const type = rec[0];
    if (rec.byteLength === 0 || type === undefined) continue;
    const text = DECODER.decode(rec.subarray(1));
    if (type === CHAR_FILE) {
      const tab = text.indexOf('\t');
      const name = tab >= 0 ? text.slice(0, tab) : text;
      const size = tab >= 0 ? Number.parseInt(text.slice(tab + 1), 10) : 0;
      entries.push({ name, size: Number.isFinite(size) ? size : 0, dir: false });
    } else if (type === CHAR_DIR) {
      entries.push({ name: text, size: 0, dir: true });
    }
    // 'S' (skip, e.g. "." / "..") and unknown record types are counted but
    // not surfaced as entries.
  }
  return { entries, count };
}

/** Concatenate `chunks` (total `total` bytes) into a single `Uint8Array`. */
function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * Implements the frozen {@link FtpClientApi} (list + read) on top of an injected
 * host send/tap pair. See the file header and ./README.md for the contract.
 */
export class FtpClient implements FtpClientApi {
  private readonly sendMessage: FtpSendFn;
  private readonly target: FtpTarget;
  private readonly clock: FtpClock;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly chunkSize: number;
  private readonly unsubscribe: () => void;
  private pending: Pending | undefined;
  /** Next request sequence number; each transaction reserves a fresh pair. */
  private seq = 0;
  private disposed = false;

  constructor(deps: FtpClientDeps) {
    this.sendMessage = deps.sendMessage;
    this.target = deps.target;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.timeoutMs = deps.timeoutMs ?? 800;
    this.maxRetries = deps.maxRetries ?? 4;
    this.chunkSize = Math.min(deps.chunkSize ?? FTP_MAX_DATA, FTP_MAX_DATA);
    this.unsubscribe = deps.onMessage([FTP_MSG_NAME], (msg) => this.onReply(msg));
  }

  /**
   * List directory `path`, paging `ListDirectory` by entry offset until the
   * server reports end-of-listing. Rejects with an {@link FtpError} on a
   * non-EOF NAK, timeout, or abort.
   */
  async list(path: string): Promise<FtpEntry[]> {
    this.ensureLive();
    const pathBytes = ENCODER.encode(path);
    const entries: FtpEntry[] = [];
    let offset = 0;
    for (;;) {
      const reply = await this.transact({
        opcode: FtpOpcode.ListDirectory,
        session: 0,
        offset,
        data: pathBytes,
      });
      if (reply.opcode === FtpOpcode.Nak) {
        const code = reply.data[0] ?? FtpNak.Fail;
        if (code === FtpNak.EndOfFile) break;
        throw new FtpError(`list "${path}" failed: ${nakName(code)}`, 'nak', code);
      }
      const { entries: page, count } = parseListing(reply.data);
      entries.push(...page);
      if (count === 0) break; // defensive: no progress ⇒ stop paging
      offset += count;
    }
    return entries;
  }

  /**
   * Read file `path` fully: `OpenFileRO`, then prefer `BurstReadFile` streaming
   * pages and fall back to sequential `ReadFile` if the peer does not support
   * burst (or if a burst page cannot make contiguous progress). `onProgress`
   * reports `(bytesSoFar, fileSize)` (total falls back to bytesSoFar when the
   * server does not report a size). A `signal` abort rejects promptly; the
   * session is still terminated on a best-effort basis.
   */
  async read(
    path: string,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    this.ensureLive();
    const open = await this.transact(
      { opcode: FtpOpcode.OpenFileRO, session: 0, offset: 0, data: ENCODER.encode(path) },
      signal,
    );
    if (open.opcode === FtpOpcode.Nak) {
      const code = open.data[0] ?? FtpNak.Fail;
      throw new FtpError(`open "${path}" failed: ${nakName(code)}`, 'nak', code);
    }
    const session = open.session;
    const fileSize = readU32LE(open.data);

    const chunks: Uint8Array[] = [];
    let offset = 0;
    try {
      const burst = await this.readBurst(
        path,
        session,
        fileSize,
        chunks,
        offset,
        onProgress,
        signal,
      );
      offset = burst.offset;
      if (!burst.complete) {
        offset = await this.readSequential(
          path,
          session,
          fileSize,
          chunks,
          offset,
          onProgress,
          signal,
        );
      }
    } finally {
      await this.terminate(session);
    }
    return concat(chunks, offset);
  }

  /**
   * Create/truncate `path` and write `data` in bounded MAVLink FTP chunks.
   * Rejects on any server NAK; once `CreateFile` returns a session, session
   * termination is attempted in a `finally`.
   */
  async write(path: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.ensureLive();
    const open = await this.transact(
      { opcode: FtpOpcode.CreateFile, session: 0, offset: 0, data: ENCODER.encode(path) },
      signal,
    );
    if (open.opcode === FtpOpcode.Nak) {
      const code = open.data[0] ?? FtpNak.Fail;
      throw new FtpError(`create "${path}" failed: ${nakName(code)}`, 'nak', code);
    }

    const session = open.session;
    try {
      for (let offset = 0; offset < data.byteLength; offset += this.chunkSize) {
        const chunk = data.subarray(offset, Math.min(offset + this.chunkSize, data.byteLength));
        const reply = await this.transact(
          { opcode: FtpOpcode.WriteFile, session, offset, size: chunk.byteLength, data: chunk },
          signal,
        );
        if (reply.opcode === FtpOpcode.Nak) {
          const code = reply.data[0] ?? FtpNak.Fail;
          throw new FtpError(`write "${path}" failed at ${offset}: ${nakName(code)}`, 'nak', code);
        }
      }
    } finally {
      await this.terminate(session);
    }
  }

  /** Remove file `path` with one `RemoveFile` transaction, rejecting on NAK. */
  async remove(path: string, signal?: AbortSignal): Promise<void> {
    this.ensureLive();
    const reply = await this.transact(
      { opcode: FtpOpcode.RemoveFile, session: 0, offset: 0, data: ENCODER.encode(path) },
      signal,
    );
    if (reply.opcode === FtpOpcode.Nak) {
      const code = reply.data[0] ?? FtpNak.Fail;
      throw new FtpError(`remove "${path}" failed: ${nakName(code)}`, 'nak', code);
    }
  }

  /**
   * Tear down: unsubscribe the reply tap and reject any in-flight transaction.
   * Not part of the frozen interface; call when discarding the client.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.pending = undefined;
  }

  // --- internals ----------------------------------------------------------

  /** Throw if the client has been disposed. */
  private ensureLive(): void {
    if (this.disposed) throw new FtpError('FTP client disposed', 'aborted');
  }

  /**
   * Prefer `BurstReadFile` for file reads. Each burst request may yield multiple
   * ACK frames; only contiguous offsets are appended. Gaps or out-of-order frames
   * are handled by re-requesting the first missing offset, and repeated lack of
   * progress falls back to the sequential reader.
   */
  private async readBurst(
    path: string,
    session: number,
    fileSize: number,
    chunks: Uint8Array[],
    startOffset: number,
    onProgress: ((done: number, total: number) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ offset: number; complete: boolean }> {
    let offset = startOffset;
    let noProgress = 0;
    const maxNoProgress = this.maxRetries + 1;

    for (;;) {
      if (fileSize > 0 && offset >= fileSize) return { offset, complete: true };

      let result: BurstResult;
      try {
        result = await this.transactBurst(
          { opcode: FtpOpcode.BurstReadFile, session, offset, size: this.chunkSize },
          signal,
        );
      } catch (err) {
        if (err instanceof FtpError && err.reason === 'timeout' && offset === startOffset) {
          return { offset, complete: false };
        }
        throw err;
      }

      if (result.nak !== undefined) {
        if (result.nak === FtpNak.EndOfFile) return { offset, complete: true };
        if (offset === startOffset && result.nak === FtpNak.UnknownCommand) {
          return { offset, complete: false };
        }
        throw new FtpError(
          `burst read "${path}" failed: ${nakName(result.nak)}`,
          'nak',
          result.nak,
        );
      }

      const before = offset;
      const appended = this.appendContiguousBurstFrames(
        result.frames,
        chunks,
        offset,
        fileSize,
        onProgress,
      );
      offset = appended.offset;
      if (appended.eof || (fileSize > 0 && offset >= fileSize)) {
        return { offset, complete: true };
      }
      if (offset > before) {
        noProgress = 0;
      } else {
        noProgress++;
        if (noProgress > maxNoProgress) return { offset, complete: false };
      }

      if (!result.complete && offset === before) {
        noProgress++;
        if (noProgress > maxNoProgress) return { offset, complete: false };
      }
    }
  }

  /** Append sorted, contiguous burst ACK frames and report progress. */
  private appendContiguousBurstFrames(
    frames: readonly FtpPayload[],
    chunks: Uint8Array[],
    startOffset: number,
    fileSize: number,
    onProgress: ((done: number, total: number) => void) | undefined,
  ): { offset: number; eof: boolean } {
    let offset = startOffset;
    const ordered = [...frames]
      .filter((frame) => frame.opcode === FtpOpcode.Ack)
      .sort((a, b) => a.offset - b.offset);

    for (const frame of ordered) {
      if (frame.offset < offset) continue;
      if (frame.offset > offset) break;
      if (frame.data.byteLength === 0) return { offset, eof: true };
      chunks.push(frame.data);
      offset += frame.data.byteLength;
      onProgress?.(offset, fileSize > 0 ? fileSize : offset);
      if (frame.data.byteLength < this.chunkSize) return { offset, eof: true };
      if (fileSize > 0 && offset >= fileSize) return { offset, eof: true };
    }
    return { offset, eof: false };
  }

  /** Sequential `ReadFile` fallback used when burst is unsupported or stalls. */
  private async readSequential(
    path: string,
    session: number,
    fileSize: number,
    chunks: Uint8Array[],
    startOffset: number,
    onProgress: ((done: number, total: number) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<number> {
    let offset = startOffset;
    for (;;) {
      const reply = await this.transact(
        { opcode: FtpOpcode.ReadFile, session, offset, size: this.chunkSize },
        signal,
      );
      if (reply.opcode === FtpOpcode.Nak) {
        const code = reply.data[0] ?? FtpNak.Fail;
        if (code === FtpNak.EndOfFile) break;
        throw new FtpError(`read "${path}" failed: ${nakName(code)}`, 'nak', code);
      }
      if (reply.data.byteLength === 0) break;
      chunks.push(reply.data);
      offset += reply.data.byteLength;
      onProgress?.(offset, fileSize > 0 ? fileSize : offset);
      if (reply.data.byteLength < this.chunkSize) break;
      if (fileSize > 0 && offset >= fileSize) break;
    }
    return offset;
  }

  /**
   * Run one request/response transaction: encode + send the FTP payload, await
   * the correlated reply (`reply.seq === request.seq + 1`), retrying the
   * identical frame on timeout up to `maxRetries`. Resolves with the decoded
   * reply for BOTH Ack and Nak (callers interpret NAK codes); rejects only on
   * timeout, abort, or send failure.
   */
  private transact(
    req: { opcode: number; session: number; offset: number; size?: number; data?: Uint8Array },
    signal?: AbortSignal,
  ): Promise<FtpPayload> {
    const data = req.data ?? EMPTY;
    const size = req.size ?? data.byteLength;
    const reqSeq = this.seq;
    // Reserve a fresh seq pair so late replies can never alias a later request.
    this.seq = (this.seq + 2) & 0xffff;
    const expectedSeq = (reqSeq + 1) & 0xffff;

    return new Promise<FtpPayload>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new FtpError('FTP operation aborted', 'aborted'));
        return;
      }
      let attempts = 0;
      let cancelTimer: (() => void) | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = (): void => {
        cancelTimer?.();
        if (onAbort !== undefined && signal !== undefined)
          signal.removeEventListener('abort', onAbort);
        if (this.pending?.expectedSeq === expectedSeq) this.pending = undefined;
      };
      const fail = (err: FtpError): void => {
        cleanup();
        reject(err);
      };
      const succeed = (p: FtpPayload): void => {
        cleanup();
        resolve(p);
      };

      this.pending = {
        expectedSeq,
        requestOpcode: req.opcode,
        session: req.session,
        burst: false,
        highestSeq: expectedSeq,
        resolve: succeed,
      };

      const attempt = (): void => {
        attempts++;
        const payload = encodePayload({
          seq: reqSeq,
          session: req.session,
          opcode: req.opcode,
          offset: req.offset,
          size,
          data,
        });
        Promise.resolve(
          this.sendMessage(FTP_MSG_NAME, {
            target_network: this.target.network,
            target_system: this.target.system,
            target_component: this.target.component,
            payload,
          }),
        ).catch((err: unknown) => {
          fail(
            new FtpError(
              `FTP send failed: ${err instanceof Error ? err.message : String(err)}`,
              'send-failed',
            ),
          );
        });
        cancelTimer = this.clock.setTimeout(() => {
          if (attempts > this.maxRetries) {
            fail(new FtpError(`FTP request timed out after ${attempts} attempts`, 'timeout'));
          } else {
            attempt();
          }
        }, this.timeoutMs);
      };

      if (signal !== undefined) {
        onAbort = (): void => fail(new FtpError('FTP operation aborted', 'aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
      }
      attempt();
    });
  }

  /**
   * Run a burst-read request that may receive several ACK frames for one
   * sequence number. Timeouts with partial data resolve the partial page so the
   * caller can re-request the first missing offset; timeouts with no data retry
   * the identical request up to `maxRetries`.
   */
  private transactBurst(
    req: { opcode: number; session: number; offset: number; size?: number; data?: Uint8Array },
    signal?: AbortSignal,
  ): Promise<BurstResult> {
    const data = req.data ?? EMPTY;
    const size = req.size ?? data.byteLength;
    const reqSeq = this.seq;
    this.seq = (this.seq + 2) & 0xffff;
    const expectedSeq = (reqSeq + 1) & 0xffff;

    return new Promise<BurstResult>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new FtpError('FTP operation aborted', 'aborted'));
        return;
      }

      const frames: FtpPayload[] = [];
      let attempts = 0;
      let settled = false;
      let cancelTimer: (() => void) | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = (): void => {
        settled = true;
        cancelTimer?.();
        if (onAbort !== undefined && signal !== undefined)
          signal.removeEventListener('abort', onAbort);
        const pending = this.pending;
        if (pending?.expectedSeq === expectedSeq) {
          this.advanceSeqPast(pending.highestSeq);
          this.pending = undefined;
        }
      };
      const fail = (err: FtpError): void => {
        cleanup();
        reject(err);
      };
      const succeed = (result: BurstResult): void => {
        cleanup();
        resolve(result);
      };
      const scheduleTimer = (): void => {
        cancelTimer?.();
        cancelTimer = this.clock.setTimeout(() => {
          if (settled) return;
          if (frames.length > 0) {
            succeed({ frames, complete: false });
          } else if (attempts > this.maxRetries) {
            fail(new FtpError(`FTP burst request timed out after ${attempts} attempts`, 'timeout'));
          } else {
            attempt();
          }
        }, this.timeoutMs);
      };
      const attempt = (): void => {
        attempts++;
        const payload = encodePayload({
          seq: reqSeq,
          session: req.session,
          opcode: req.opcode,
          offset: req.offset,
          size,
          data,
        });
        Promise.resolve(
          this.sendMessage(FTP_MSG_NAME, {
            target_network: this.target.network,
            target_system: this.target.system,
            target_component: this.target.component,
            payload,
          }),
        ).catch((err: unknown) => {
          fail(
            new FtpError(
              `FTP send failed: ${err instanceof Error ? err.message : String(err)}`,
              'send-failed',
            ),
          );
        });
        scheduleTimer();
      };

      this.pending = {
        expectedSeq,
        requestOpcode: req.opcode,
        session: req.session,
        burst: true,
        highestSeq: expectedSeq,
        onReply: (payload: FtpPayload): void => {
          if (payload.opcode === FtpOpcode.Nak) {
            succeed({ frames, nak: payload.data[0] ?? FtpNak.Fail, complete: true });
            return;
          }
          if (payload.opcode !== FtpOpcode.Ack) return;
          frames.push(payload);
          if (payload.burstComplete !== 0 || payload.data.byteLength === 0) {
            succeed({ frames, complete: true });
          } else {
            scheduleTimer();
          }
        },
      };

      if (signal !== undefined) {
        onAbort = (): void => fail(new FtpError('FTP operation aborted', 'aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
      }
      attempt();
    });
  }

  /** Move the next client request sequence beyond an observed server sequence. */
  private advanceSeqPast(serverSeq: number): void {
    if (this.seq === serverSeq || seqAfter(this.seq, serverSeq))
      this.seq = (serverSeq + 1) & 0xffff;
  }

  /** Best-effort `TerminateSession` — swallows errors (cleanup, not a result). */
  private async terminate(session: number): Promise<void> {
    try {
      await this.transact({ opcode: FtpOpcode.TerminateSession, session, offset: 0 });
    } catch {
      /* the session times out server-side anyway; nothing to surface */
    }
  }

  /** Correlate an incoming `FILE_TRANSFER_PROTOCOL` to the pending transaction. */
  private onReply(msg: DecodedMessage): void {
    if (msg.sysid !== this.target.system || msg.compid !== this.target.component) return;
    const raw = asByteArray(msg.fields.payload);
    if (raw === undefined) return;
    const pending = this.pending;
    if (pending === undefined) return;
    const payload = decodePayload(raw);
    if (payload.reqOpcode !== pending.requestOpcode) return;
    if (pending.burst) {
      if (payload.session !== pending.session) return;
      if (!seqAtOrAfter(pending.expectedSeq, payload.seq)) return;
      if (seqAfter(pending.highestSeq, payload.seq)) pending.highestSeq = payload.seq;
      pending.onReply?.(payload);
      return;
    }
    if (payload.seq !== pending.expectedSeq) return;
    pending.resolve?.(payload);
  }
}

/** Construct an {@link FtpClient} (ergonomic factory mirroring sibling services). */
export function createFtpClient(deps: FtpClientDeps): FtpClient {
  return new FtpClient(deps);
}
