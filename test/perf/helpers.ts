/** Shared helpers for the opt-in T8.10 performance harness. */

/** A timing sample set with convenience aggregate fields. */
export interface TimingStats {
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

/** Heap/RSS sample, when the Node runtime exposes process.memoryUsage. */
export interface MemorySample {
  readonly heapUsed: number;
  readonly rss: number;
}

interface StdoutProvider {
  write?: (chunk: string) => unknown;
}

interface MemoryUsageProvider {
  memoryUsage?: () => MemorySample;
  stdout?: StdoutProvider;
}

interface RuntimeWithProcess {
  process?: MemoryUsageProvider;
}

/** Format bytes as MiB for stable console reports. */
export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Format a rate with thousands separators and fixed decimals. */
export function formatRate(value: number, digits = 0): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/** Print a perf line even when the Vitest reporter captures console methods. */
export function reportPerfLine(line: string): void {
  const runtime = globalThis as RuntimeWithProcess;
  if (runtime.process?.stdout?.write !== undefined) {
    runtime.process.stdout.write(`${line}\n`);
    return;
  }
  console.info(line);
}

/** Return a lightweight memory sample when available in the current runtime. */
export function sampleMemory(): MemorySample | undefined {
  const runtime = globalThis as RuntimeWithProcess;
  return runtime.process?.memoryUsage?.();
}

/** Positive delta between two optional memory samples. */
export function heapDeltaBytes(
  before: MemorySample | undefined,
  after: MemorySample | undefined,
): number | undefined {
  if (before === undefined || after === undefined) return undefined;
  return Math.max(0, after.heapUsed - before.heapUsed);
}

/** Measure one synchronous operation and return its elapsed milliseconds. */
export function measureSync(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Summarize an array of millisecond samples. */
export function summarizeTimings(samples: readonly number[]): TimingStats {
  if (samples.length === 0) return { count: 0, totalMs: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((sum, sample) => sum + sample, 0);
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95Ms = sorted[p95Index] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  return { count: samples.length, totalMs, avgMs: totalMs / samples.length, p95Ms, maxMs };
}

/** Concatenate byte arrays into one fresh ArrayBuffer-backed Uint8Array. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
