import { type EntryEntity, InvariantViolationError } from '@lux/ledger';
import type { EntryResponse } from '../contracts/entries';

export const toEntryResponse = (entry: EntryEntity): EntryResponse => {
  if (!entry.id || !entry.transactionId || !entry.createdAt) {
    throw new InvariantViolationError('entry must be persisted before listing');
  }
  return {
    id: entry.id,
    transaction_id: entry.transactionId,
    account_id: entry.accountId.value,
    direction: entry.direction,
    amount_minor: entry.money.amountMinor.toString(),
    currency: entry.money.currency,
    created_at: entry.createdAt.toISOString(),
  };
};
