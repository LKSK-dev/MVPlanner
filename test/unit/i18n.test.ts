import { describe, it, expect } from 'vitest';
import { t } from '../../src/core/i18n';

describe('i18n t()', () => {
  it('returns the mapped string for a known key', () => {
    expect(t('app.name')).toBe('MVPlanner');
  });

  it('falls back to the key when unknown', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('substitutes {var} placeholders', () => {
    expect(t('screen.placeholder', { screen: 'Flight' })).toBe(
      'Flight — coming in a later milestone',
    );
  });
});
