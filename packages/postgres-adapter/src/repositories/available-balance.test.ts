import { describe, expect, it } from 'bun:test';
import { EntryDirection } from '@luxledger/core';
import { InvariantViolationError } from '@luxledger/core/application';
import { aggregateAccountEntries } from './available-balance';

describe('aggregateAccountEntries', () => {
  it('sums mixed directions per account without changing the input', () => {
    const entries = [
      { accountId: 'b', direction: EntryDirection.CREDIT, amountMinor: 3n },
      { accountId: 'a', direction: EntryDirection.DEBIT, amountMinor: 7n },
      { accountId: 'a', direction: EntryDirection.CREDIT, amountMinor: 2n },
      { accountId: 'a', direction: EntryDirection.DEBIT, amountMinor: 1n },
    ];
    expect(aggregateAccountEntries(entries)).toEqual([
      { accountId: 'a', debitMinor: 8n, creditMinor: 2n },
      { accountId: 'b', debitMinor: 0n, creditMinor: 3n },
    ]);
    expect(entries[0].accountId).toBe('b');
  });

  it('rejects an unsupported direction instead of treating it as a credit', () => {
    expect(() =>
      aggregateAccountEntries([{ accountId: 'a', direction: 'INVALID', amountMinor: 10n }]),
    ).toThrow(InvariantViolationError);
  });
});
