import { describe, expect, it } from 'bun:test';
import { InvalidAmountError } from '../transaction/errors';
import { aggregateAccountEntries, calculateAvailableMinor } from './available-balance';

describe('aggregateAccountEntries', () => {
  it('sums mixed directions per account without changing the input', () => {
    const entries = [
      { accountId: 'b', signedAmountMinor: -3n },
      { accountId: 'a', signedAmountMinor: 7n },
      { accountId: 'a', signedAmountMinor: -2n },
      { accountId: 'a', signedAmountMinor: 1n },
    ];
    expect(aggregateAccountEntries(entries)).toEqual([
      { accountId: 'a', signedAmountMinor: 6n, debitMinor: 8n, creditMinor: 2n },
      { accountId: 'b', signedAmountMinor: -3n, debitMinor: 0n, creditMinor: 3n },
    ]);
    expect(entries[0].accountId).toBe('b');
  });

  it('rejects a zero signed amount', () => {
    expect(() => aggregateAccountEntries([{ accountId: 'a', signedAmountMinor: 0n }])).toThrow(
      InvalidAmountError,
    );
  });

  it('accepts either sign and rejects empty account IDs', () => {
    expect(() =>
      aggregateAccountEntries([{ accountId: 'a', signedAmountMinor: -1n }]),
    ).not.toThrow();
    expect(() => aggregateAccountEntries([{ accountId: '', signedAmountMinor: 1n }])).toThrow(
      'AccountId must be a non-empty string',
    );
  });

  it('calculates signed availability from posted and in-flight amounts', () => {
    expect(
      calculateAvailableMinor({
        side: 'DEBIT',
        balanceMinor: 100n,
        inflightDebitMinor: 20n,
        inflightCreditMinor: 70n,
      }),
    ).toBe(50n);
  });
});
