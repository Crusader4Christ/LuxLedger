import { describe, expect, it } from 'bun:test';

import { InvalidTransactionMetadataError } from './errors';
import {
  canonicalizeTransactionMetadata,
  type TransactionMetadata,
  transactionMetadataEquals,
  validateTransactionMetadata,
} from './metadata';

describe('transaction metadata', () => {
  it('accepts nested JSON without copying or freezing it', () => {
    const source = {
      provider: 'stripe',
      attempt: 2,
      settled: false,
      optional: null,
      identifiers: ['pi_1', 7, true, null, { region: 'eu' }],
    };

    validateTransactionMetadata(source);
    source.provider = 'changed';
    source.identifiers[0] = 'changed';
    (source.identifiers[4] as { region: string }).region = 'changed';

    expect(source).toEqual({
      provider: 'changed',
      attempt: 2,
      settled: false,
      optional: null,
      identifiers: ['changed', 7, true, null, { region: 'changed' }],
    });
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.identifiers)).toBe(false);
  });

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

  it('canonicalizes object keys while preserving array order and value types', () => {
    const left = { z: { b: 2, a: 1 }, values: ['1', 1] };
    const reordered = { values: ['1', 1], z: { a: 1, b: 2 } };

    expect(canonicalizeTransactionMetadata(left)).toBe('{"values":["1",1],"z":{"a":1,"b":2}}');
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
