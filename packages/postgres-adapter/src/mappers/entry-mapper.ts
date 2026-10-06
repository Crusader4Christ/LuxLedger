import { AccountId, EntryEntity, Money } from '@luxledger/core';
import type * as schema from '../schema';

export const toEntryEntity = (row: typeof schema.entries.$inferSelect): EntryEntity =>
  new EntryEntity({
    id: row.id,
    transactionId: row.transactionId,
    accountId: new AccountId(row.accountId),
    money: Money.of(row.signedAmountMinor, row.currency),
    assetId: row.assetId,
    createdAt: row.createdAt,
  });
