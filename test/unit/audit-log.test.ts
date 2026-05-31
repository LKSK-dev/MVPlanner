/**
 * Unit tests for the action audit log (task T2.7; spec plan/08 §8.3/§8.8).
 * Exercises append (defaults + clock/id injection), update (result recording +
 * unknown id), the bounded ring + eviction, subscribe fan-out + unsubscribe, and
 * JSON/text export — all against the pure service with an injected clock.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAuditLog, RingAuditLog, type AuditEntry } from '../../src/core/audit';

describe('audit log — append', () => {
  it('creates an entry with generated id and pending/ui defaults', () => {
    let now = 1000;
    const log = createAuditLog({ clock: () => now });
    const e = log.append({ kind: 'command', summary: 'Arm' });
    expect(e.id).toBeTruthy();
    expect(e.kind).toBe('command');
    expect(e.summary).toBe('Arm');
    expect(e.origin).toBe('ui');
    expect(e.status).toBe('pending');
    expect(e.tMs).toBe(1000);
    expect(e.tEndMs).toBeUndefined();
    expect(log.list()).toHaveLength(1);

    now = 2000;
    const e2 = log.append({ kind: 'param-set', summary: 'set A', origin: 'ext:battery' });
    expect(e2.origin).toBe('ext:battery');
    expect(e2.tMs).toBe(2000);
    expect(e2.id).not.toBe(e.id);
  });

  it('honours an injected id factory and explicit tMs override', () => {
    const ids = ['x1', 'x2'];
    let i = 0;
    const log = createAuditLog({ idFactory: () => ids[i++] ?? 'z', clock: () => 99 });
    const e = log.append({ kind: 'command', summary: 'one', tMs: 50 });
    expect(e.id).toBe('x1');
    expect(e.tMs).toBe(50);
    expect(log.append({ kind: 'command', summary: 'two' }).id).toBe('x2');
  });

  it('records structured params (map and list forms)', () => {
    const log = createAuditLog();
    const a = log.append({
      kind: 'command',
      summary: 'Takeoff',
      params: { action: 'takeoff', altM: 10 },
    });
    const b = log.append({ kind: 'command', summary: 'send', params: [1, 0, 0] });
    expect(a.params).toEqual({ action: 'takeoff', altM: 10 });
    expect(b.params).toEqual([1, 0, 0]);
  });
});

describe('audit log — update', () => {
  it('patches status/result/tEndMs by id and returns the new entry', () => {
    let now = 1000;
    const log = createAuditLog({ clock: () => now });
    const e = log.append({ kind: 'command', summary: 'Land' });
    now = 1500;
    const updated = log.update(e.id, { status: 'ok', result: 'ok', tEndMs: now });
    expect(updated?.status).toBe('ok');
    expect(updated?.result).toBe('ok');
    expect(updated?.tEndMs).toBe(1500);
    // List reflects the patched entry.
    expect(log.list()[0]?.status).toBe('ok');
  });

  it('returns undefined for an unknown id and does not mutate the log', () => {
    const log = createAuditLog();
    log.append({ kind: 'command', summary: 'RTL' });
    expect(log.update('nope', { status: 'ok' })).toBeUndefined();
    expect(log.list()).toHaveLength(1);
    expect(log.list()[0]?.status).toBe('pending');
  });
});

describe('audit log — ring bound', () => {
  it('evicts oldest entries past maxEntries (oldest-first order kept)', () => {
    const log = new RingAuditLog({ maxEntries: 3 });
    for (let n = 0; n < 5; n++) log.append({ kind: 'command', summary: `a${n}` });
    const list = log.list();
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.summary)).toEqual(['a2', 'a3', 'a4']);
  });
});

describe('audit log — subscribe', () => {
  it('notifies on append/update/clear and stops after unsubscribe', () => {
    const log = createAuditLog();
    const seen: number[] = [];
    const off = log.subscribe((entries) => seen.push(entries.length));
    const e = log.append({ kind: 'command', summary: 'Arm' });
    log.update(e.id, { status: 'ok' });
    log.clear();
    expect(seen).toEqual([1, 1, 0]);
    off();
    log.append({ kind: 'command', summary: 'after' });
    expect(seen).toEqual([1, 1, 0]);
  });

  it('does not replay current state on subscribe', () => {
    const log = createAuditLog();
    log.append({ kind: 'command', summary: 'pre' });
    const cb = vi.fn();
    log.subscribe(cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('audit log — export', () => {
  it('exports JSON round-trippable to the entry list', () => {
    const log = createAuditLog({ clock: () => 1234, idFactory: () => 'id1' });
    log.append({ kind: 'command', summary: 'Arm', result: 'ok', status: 'ok' });
    const parsed = JSON.parse(log.exportJson()) as AuditEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.summary).toBe('Arm');
    expect(parsed[0]?.status).toBe('ok');
  });

  it('exports one human-readable line per entry', () => {
    const log = createAuditLog({ clock: () => 0 });
    log.append({ kind: 'command', summary: 'Arm', status: 'ok', result: 'ok' });
    log.append({ kind: 'param-set', summary: 'set X', status: 'cancelled', result: 'cancelled' });
    const lines = log.exportText().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('OK');
    expect(lines[0]).toContain('Arm');
    expect(lines[0]).toContain('(ok)');
    expect(lines[1]).toContain('CANCELLED');
    expect(lines[1]).toContain('param-set');
  });

  it('clear empties the log (and is a no-op when already empty)', () => {
    const log = createAuditLog();
    const cb = vi.fn();
    log.subscribe(cb);
    log.clear(); // already empty → no notification
    expect(cb).not.toHaveBeenCalled();
    log.append({ kind: 'command', summary: 'x' });
    log.clear();
    expect(log.list()).toHaveLength(0);
  });
});
