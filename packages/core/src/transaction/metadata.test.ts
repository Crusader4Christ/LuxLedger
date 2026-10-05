import { describe, expect, it } from 'bun:test';

import { InvalidTransactionMetadataError } from './errors';
import {
  canonicalizeTransactionMetadata,
  type TransactionMetadata,
  transactionMetadataEquals,
  validateTransactionMetadata,
} from './metadata';

describe('transaction metadata', () => {
  it('rejects every non-object root shape', () => {
    for (const value of [undefined, null, [], 'value', 1, true]) {
      expect(() => validateTransactionMetadata(value)).toThrowError(
        InvalidTransactionMetadataError,
      );
    }
  });

  it('rejects non-JSON nested values and object shapes', () => {
    const sparse = new Array(1);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const symbolKey = Symbol('private');
    const withSymbolKey = { valid: true, [symbolKey]: 'hidden' };
    const withOutOfBoundsArrayProperty: unknown[] = [];
    Object.defineProperty(withOutOfBoundsArrayProperty, '4294967295', {
      enumerable: true,
      value: 'not-an-array-index',
    });
    const withAccessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'computed',
    });

    for (const value of [
      { value: undefined },
      { value: [undefined] },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: 1n },
      { value: Symbol('value') },
      { value: () => true },
      { value: new Date() },
      { value: sparse },
      { value: withOutOfBoundsArrayProperty },
      circular,
      withSymbolKey,
      withAccessor,
    ]) {
      expect(() => validateTransactionMetadata(value)).toThrowError(
        InvalidTransactionMetadataError,
      );
    }
  });

  it('accepts nested JSON and canonicalizes object keys without changing array semantics', () => {
    const left = { z: { b: 2, a: 1 }, values: ['1', 1, false, null, { nested: ['x', true] }] };
    const reordered = {
      values: ['1', 1, false, null, { nested: ['x', true] }],
      z: { a: 1, b: 2 },
    };

    expect(canonicalizeTransactionMetadata(left)).toBe(
      '{"values":["1",1,false,null,{"nested":["x",true]}],"z":{"a":1,"b":2}}',
    );
    expect(transactionMetadataEquals(left, reordered)).toBe(true);
    expect(transactionMetadataEquals(left, { ...reordered, values: [1, '1'] })).toBe(false);
    expect(transactionMetadataEquals({ value: 1 }, { value: '1' })).toBe(false);
  });

  it('distinguishes omitted, empty, and changed retry metadata', () => {
    expect(transactionMetadataEquals(undefined, undefined)).toBe(true);
    expect(transactionMetadataEquals(undefined, {})).toBe(false);
    expect(transactionMetadataEquals({}, {})).toBe(true);
    expect(
      transactionMetadataEquals({ provider: { id: 'first' } }, { provider: { id: 'changed' } }),
    ).toBe(false);
  });

  it('validates typed inputs again at the runtime boundary', () => {
    const invalid = { value: undefined } as unknown as TransactionMetadata;

    expect(() => canonicalizeTransactionMetadata(invalid)).toThrowError(
      InvalidTransactionMetadataError,
    );
  });
});
