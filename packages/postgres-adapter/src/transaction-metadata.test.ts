import { describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@luxledger/core/application';
import {
  MAX_TRANSACTION_METADATA_BYTES,
  toStoredTransactionMetadata,
} from './transaction-metadata';

const metadataOfSize = (bytes: number) => {
  const overhead = new TextEncoder().encode(JSON.stringify({ p: '' })).byteLength;
  return { p: 'x'.repeat(bytes - overhead) };
};

describe('toStoredTransactionMetadata', () => {
  it('stores omitted metadata as SQL NULL and keeps an empty object distinct', () => {
    expect(toStoredTransactionMetadata(undefined)).toBeNull();
    expect(toStoredTransactionMetadata({})).toEqual({});
  });

  it('keeps nested objects and ordered arrays unchanged', () => {
    const metadata = { b: { list: [3, 1, 2] }, a: [{ z: 1, y: null }] };

    expect(toStoredTransactionMetadata(metadata)).toBe(metadata);
  });

  it('rejects null, arrays, and primitives', () => {
    for (const metadata of [null, [], [{}], 'metadata', 42, true]) {
      expect(() => toStoredTransactionMetadata(metadata as never)).toThrow(InvariantViolationError);
    }
  });

  it('rejects values that cannot be serialized to JSON', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => toStoredTransactionMetadata({ amount: 1n } as never)).toThrow(
      'Transaction metadata must be a JSON object',
    );
    expect(() => toStoredTransactionMetadata(circular as never)).toThrow(
      'Transaction metadata must be a JSON object',
    );
  });

  it('accepts metadata exactly at the byte limit and rejects one byte above it', () => {
    const atLimit = metadataOfSize(MAX_TRANSACTION_METADATA_BYTES);
    const aboveLimit = metadataOfSize(MAX_TRANSACTION_METADATA_BYTES + 1);

    expect(toStoredTransactionMetadata(atLimit)).toBe(atLimit);
    expect(() => toStoredTransactionMetadata(aboveLimit)).toThrow(
      `Transaction metadata must not exceed ${MAX_TRANSACTION_METADATA_BYTES} bytes`,
    );
  });

  it('measures the limit in UTF-8 bytes rather than characters', () => {
    const metadata = { p: '€'.repeat(MAX_TRANSACTION_METADATA_BYTES / 3) };

    expect(metadata.p.length).toBeLessThan(MAX_TRANSACTION_METADATA_BYTES);
    expect(() => toStoredTransactionMetadata(metadata)).toThrow(InvariantViolationError);
  });
});
