import { AccountId, EntryEntity, Money, parseEntryDirection } from '@lux/ledger';
import type * as schema from '../schema';

export const toEntryEntity = (row: typeof schema.entries.$inferSelect): EntryEntity =>
  new EntryEntity({
    id: row.id,
    transactionId: row.transactionId,
    accountId: new AccountId(row.accountId),
    direction: parseEntryDirection(row.direction),
    money: Money.of(row.amountMinor, row.currency),
    createdAt: row.createdAt,
  });
