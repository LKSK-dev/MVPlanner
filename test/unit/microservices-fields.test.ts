import { describe, it, expect } from 'vitest';
import { numField } from '../../src/mavlink/microservices/fields';
import type { FieldValue } from '../../src/contracts';

describe('microservices fields helpers', () => {
  describe('numField', () => {
    it('returns a number field unchanged', () => {
      const fields: Record<string, FieldValue> = { seq: 7, alt: -3.5 };
      expect(numField(fields, 'seq')).toBe(7);
      expect(numField(fields, 'alt')).toBe(-3.5);
    });

    it('passes through zero and NaN like the original copies', () => {
      const fields: Record<string, FieldValue> = { zero: 0, nan: NaN };
      expect(numField(fields, 'zero')).toBe(0);
      expect(numField(fields, 'nan')).toBeNaN();
    });

    it('coerces a bigint field via Number()', () => {
      const fields: Record<string, FieldValue> = { mask: 0xff00ff00ff00n, big: 2n ** 60n };
      expect(numField(fields, 'mask')).toBe(Number(0xff00ff00ff00n));
      expect(numField(fields, 'big')).toBe(Number(2n ** 60n));
    });

    it('returns undefined for a missing key', () => {
      expect(numField({}, 'absent')).toBeUndefined();
    });

    it('returns undefined for string and array fields', () => {
      const fields: Record<string, FieldValue> = { text: '42', bytes: [1, 2, 3] };
      expect(numField(fields, 'text')).toBeUndefined();
      expect(numField(fields, 'bytes')).toBeUndefined();
    });
  });
});
