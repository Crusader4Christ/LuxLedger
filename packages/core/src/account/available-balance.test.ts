import { describe, expect, it } from 'bun:test';
import { EntryDirection } from '../entry/entity';
import { InvalidDirectionError } from '../transaction/errors';
import { aggregateAccountEntries, calculateAvailableMinor } from './available-balance';

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

  it('uses core direction validation for unsafe runtime input', () => {
    expect(() =>
      aggregateAccountEntries([
        { accountId: 'a', direction: 'INVALID' as EntryDirection, amountMinor: 10n },
      ]),
    ).toThrow(InvalidDirectionError);
  });

  it('calculates signed availability from posted and in-flight amounts', () => {
    expect(
      calculateAvailableMinor({
        balanceMinor: 100n,
        inflightDebitMinor: 70n,
        inflightCreditMinor: 20n,
      }),
    ).toBe(50n);
  });
});
