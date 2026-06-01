/**
 * Scripting execution-engine tests (task T7.4; spec plan/06 §6.7).
 *
 * Pure: runs script strings against a MOCK `mvp` and asserts the engine's
 * contract — returns the (pretty-printed) value, supports top-level `await`,
 * captures `console.*` output, surfaces thrown/compile errors without crashing,
 * and times out a never-settling script. Also covers the value formatter and
 * the user-scoped stack trimmer.
 */
import { describe, it, expect } from 'vitest';
import type { ExtContext, Param } from '../../src/contracts';
import { formatValue, runScript, scopeStack } from '../../src/ext/scripting';

/** A minimal `mvp` whose `params.get` returns a fixed param (enough for await). */
function fakeMvp(): ExtContext {
  const param: Param = { name: 'PSC_POSXY_P', value: 42, type: 9 };
  return {
    version: '1.0.0-test',
    params: {
      get: (): Param => param,
      fetchAll: (): Promise<Param[]> => Promise.resolve([param]),
    },
  } as unknown as ExtContext;
}

describe('runScript', () => {
  it('returns the evaluated value', async () => {
    const r = await runScript({ code: 'return 1 + 1', mvp: fakeMvp() });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(2);
    expect(r.valueText).toBe('2');
    expect(r.timedOut).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it('supports top-level await against the mock mvp', async () => {
    const r = await runScript({
      code: "const p = await mvp.params.get('PSC_POSXY_P'); return p.value",
      mvp: fakeMvp(),
    });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  it('awaits a Promise-returning API method', async () => {
    const r = await runScript({
      code: 'return (await mvp.params.fetchAll()).length',
      mvp: fakeMvp(),
    });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1);
  });

  it('captures console output in order', async () => {
    const r = await runScript({
      code: "console.log('hello', 42); console.warn('careful'); return 'done'",
      mvp: fakeMvp(),
    });
    expect(r.ok).toBe(true);
    expect(r.value).toBe('done');
    expect(r.logs).toHaveLength(2);
    expect(r.logs[0]).toMatchObject({ level: 'log', text: 'hello 42' });
    expect(r.logs[1]).toMatchObject({ level: 'warn', text: 'careful' });
  });

  it('surfaces a thrown error without rejecting', async () => {
    const r = await runScript({ code: "throw new TypeError('boom')", mvp: fakeMvp() });
    expect(r.ok).toBe(false);
    expect(r.error?.name).toBe('TypeError');
    expect(r.error?.message).toBe('boom');
    expect(r.value).toBeUndefined();
  });

  it('reports a syntax error as a failed run', async () => {
    const r = await runScript({ code: 'return )(', mvp: fakeMvp() });
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('keeps console output produced before a throw', async () => {
    const r = await runScript({
      code: "console.log('before'); throw new Error('later')",
      mvp: fakeMvp(),
    });
    expect(r.ok).toBe(false);
    expect(r.logs.map((l) => l.text)).toEqual(['before']);
  });

  it('times out a never-settling script', async () => {
    const r = await runScript({
      code: 'await new Promise(() => {}); return 1',
      mvp: fakeMvp(),
      timeoutMs: 20,
    });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error?.name).toBe('TimeoutError');
  });

  it('aborts when the signal fires', async () => {
    const ac = new AbortController();
    const promise = runScript({
      code: 'await new Promise(() => {}); return 1',
      mvp: fakeMvp(),
      timeoutMs: 0,
      signal: ac.signal,
    });
    ac.abort();
    const r = await promise;
    expect(r.timedOut).toBe(true);
  });
});

describe('formatValue', () => {
  it('quotes strings and renders primitives', () => {
    expect(formatValue('hi')).toBe('"hi"');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(10n)).toBe('10n');
    expect(formatValue(true)).toBe('true');
  });

  it('pretty-prints arrays and objects', () => {
    expect(formatValue([1, 2])).toBe('[\n  1,\n  2\n]');
    expect(formatValue({ a: 1 })).toBe('{\n  a: 1\n}');
    expect(formatValue({})).toBe('{}');
  });

  it('handles circular references', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(formatValue(o)).toContain('[Circular]');
  });
});

describe('scopeStack', () => {
  it('keeps the header and only user frames', () => {
    const stack = [
      'Error: boom',
      '    at mvp-script.js:2:7',
      '    at runScript (/app/src/ext/scripting/engine.ts:10:1)',
    ].join('\n');
    const scoped = scopeStack(stack);
    expect(scoped).toBe('Error: boom\n    at mvp-script.js:2:7');
  });

  it('falls back to the header when no user frames match', () => {
    expect(scopeStack('Error: boom\n    at engine.ts:1:1')).toBe('Error: boom');
  });

  it('returns undefined for no stack', () => {
    expect(scopeStack(undefined)).toBeUndefined();
  });
});
