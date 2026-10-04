import { describe, expect, it } from 'bun:test';

import { AccountId, LedgerId, Money, TransactionId } from '../base';
import { EntryDirection, EntryEntity } from '../entry/entity';
import { TransactionEntity } from './';
import {
  AssetMismatchError,
  MissingReferenceError,
  NotEnoughEntriesError,
  UnbalancedTransactionError,
} from './errors';

const buildEntry = (input: {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  currency?: string;
  assetId?: string | null;
}): EntryEntity =>
  new EntryEntity({
    accountId: new AccountId(input.accountId),
    direction: input.direction,
    money: Money.of(input.amountMinor, input.currency ?? 'USD'),
    assetId: input.assetId,
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

  it('keeps omitted metadata distinct from an immutable empty object', () => {
    const entries = [
      buildEntry({ accountId: 'a-1', direction: EntryDirection.DEBIT, amountMinor: 100n }),
      buildEntry({ accountId: 'a-2', direction: EntryDirection.CREDIT, amountMinor: 100n }),
    ];
    const omitted = new TransactionEntity({
      id: new TransactionId('tx-omitted'),
      ledgerId: new LedgerId('ledger-1'),
      reference: 'ref-omitted',
      currency: 'USD',
      entries,
    });
    const empty = new TransactionEntity({
      id: new TransactionId('tx-empty'),
      ledgerId: new LedgerId('ledger-1'),
      reference: 'ref-empty',
      currency: 'USD',
      metadata: {},
      entries,
    });

    expect(omitted.metadata).toBeUndefined();
    expect(empty.metadata).toEqual({});
    expect(Object.isFrozen(empty.metadata)).toBe(true);
  });

  it('stores metadata as an immutable snapshot', () => {
    const source = { provider: { id: 'external-1' } };
    const transaction = new TransactionEntity({
      id: new TransactionId('tx-1'),
      ledgerId: new LedgerId('ledger-1'),
      reference: 'ref-1',
      currency: 'USD',
      metadata: source,
      entries: [
        buildEntry({ accountId: 'a-1', direction: EntryDirection.DEBIT, amountMinor: 100n }),
        buildEntry({ accountId: 'a-2', direction: EntryDirection.CREDIT, amountMinor: 100n }),
      ],
    });

    source.provider.id = 'changed';
    expect(transaction.metadata).toEqual({ provider: { id: 'external-1' } });
    expect(Object.isFrozen(transaction.metadata?.provider)).toBe(true);
    expect(() => {
      (transaction.metadata?.provider as { id: string }).id = 'changed';
    }).toThrow();
    expect(transaction.metadata).toEqual({ provider: { id: 'external-1' } });
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

  it('rejects null or stale entry assets when transaction asset is known', () => {
    expect(
      () =>
        new TransactionEntity({
          id: new TransactionId('tx-1'),
          ledgerId: new LedgerId('ledger-1'),
          reference: 'ref-1',
          currency: 'USD',
          assetId: 'asset-usd',
          entries: [
            buildEntry({ accountId: 'a-1', direction: EntryDirection.DEBIT, amountMinor: 100n }),
            buildEntry({
              accountId: 'a-2',
              direction: EntryDirection.CREDIT,
              amountMinor: 100n,
              assetId: null,
            }),
          ],
        }),
    ).toThrowError(AssetMismatchError);
  });
});
