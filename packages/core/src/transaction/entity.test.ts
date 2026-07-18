import { describe, expect, it } from 'bun:test';

import { AccountId, LedgerId, Money, TransactionId } from '../base';
import { EntryDirection, EntryEntity } from '../entry/entity';
import { TransactionEntity } from './';
import { MissingReferenceError, NotEnoughEntriesError, UnbalancedTransactionError } from './errors';

const buildEntry = (input: {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  currency?: string;
}): EntryEntity =>
  new EntryEntity({
    accountId: new AccountId(input.accountId),
    direction: input.direction,
    money: Money.of(input.amountMinor, input.currency ?? 'USD'),
  });

describe('TransactionEntity', () => {
  it('creates a balanced transaction', () => {
    const transaction = new TransactionEntity({
      id: new TransactionId('tx-1'),
      ledgerId: new LedgerId('ledger-1'),
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        buildEntry({ accountId: 'a-1', direction: EntryDirection.DEBIT, amountMinor: 100n }),
        buildEntry({ accountId: 'a-2', direction: EntryDirection.CREDIT, amountMinor: 100n }),
      ],
    });

    expect(transaction.entries).toHaveLength(2);
  });

  it('throws for less than two entries', () => {
    expect(
      () =>
        new TransactionEntity({
          id: new TransactionId('tx-1'),
          ledgerId: new LedgerId('ledger-1'),
          reference: 'ref-1',
          currency: 'USD',
          entries: [
            buildEntry({
              accountId: 'a-1',
              direction: EntryDirection.DEBIT,
              amountMinor: 100n,
            }),
          ],
        }),
    ).toThrowError(NotEnoughEntriesError);
  });

  it('throws when reference is empty', () => {
    expect(
      () =>
        new TransactionEntity({
          id: new TransactionId('tx-1'),
          ledgerId: new LedgerId('ledger-1'),
          reference: '   ',
          currency: 'USD',
          entries: [
            buildEntry({
              accountId: 'a-1',
              direction: EntryDirection.DEBIT,
              amountMinor: 100n,
            }),
            buildEntry({
              accountId: 'a-2',
              direction: EntryDirection.CREDIT,
              amountMinor: 100n,
            }),
          ],
        }),
    ).toThrowError(MissingReferenceError);
  });

  it('throws for unbalanced entries', () => {
    expect(
      () =>
        new TransactionEntity({
          id: new TransactionId('tx-1'),
          ledgerId: new LedgerId('ledger-1'),
          reference: 'ref-1',
          currency: 'USD',
          entries: [
            buildEntry({
              accountId: 'a-1',
              direction: EntryDirection.DEBIT,
              amountMinor: 100n,
            }),
            buildEntry({
              accountId: 'a-2',
              direction: EntryDirection.CREDIT,
              amountMinor: 99n,
            }),
          ],
        }),
    ).toThrowError(UnbalancedTransactionError);
  });
});
