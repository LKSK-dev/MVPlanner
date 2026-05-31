import { describe, it, expect } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../../src/ui/shell';

describe('fuzzyScore', () => {
  it('returns a neutral score for an empty query (matches everything)', () => {
    expect(fuzzyScore('Go to Flight', '')).toBe(0);
    expect(fuzzyScore('Go to Flight', '   ')).toBe(0);
  });

  it('matches case-insensitive subsequences', () => {
    expect(fuzzyScore('Go to Flight', 'gtf')).toBeGreaterThan(0);
    expect(fuzzyScore('Go to Flight', 'flight')).toBeGreaterThan(0);
  });

  it('returns undefined when the query is not a subsequence', () => {
    expect(fuzzyScore('Go to Flight', 'xyz')).toBeUndefined();
    expect(fuzzyScore('Plan', 'plann')).toBeUndefined();
  });

  it('ranks contiguous/prefix matches above scattered ones', () => {
    const prefix = fuzzyScore('Plan', 'pla');
    const scattered = fuzzyScore('Parallax lane', 'pla');
    expect(prefix).toBeDefined();
    expect(scattered).toBeDefined();
    expect(prefix!).toBeGreaterThan(scattered!);
  });
});

describe('fuzzyFilter', () => {
  const cmds = [
    { title: 'Go to Flight' },
    { title: 'Go to Plan' },
    { title: 'Go to Logs' },
    { title: 'Open command palette' },
  ];

  it('returns the input order unchanged for an empty query', () => {
    expect(fuzzyFilter(cmds, '', (c) => c.title)).toEqual(cmds);
  });

  it('filters out non-matches and ranks best first', () => {
    const res = fuzzyFilter(cmds, 'logs', (c) => c.title);
    expect(res).toHaveLength(1);
    expect(res[0]?.title).toBe('Go to Logs');
  });

  it('keeps multiple matches ordered by score', () => {
    const res = fuzzyFilter(cmds, 'go', (c) => c.title);
    expect(res.map((c) => c.title)).toEqual(['Go to Flight', 'Go to Plan', 'Go to Logs']);
  });
});
