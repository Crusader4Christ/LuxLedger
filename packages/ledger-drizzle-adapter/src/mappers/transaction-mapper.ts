import { type EntryEntity, LedgerId, TransactionEntity, TransactionId } from '@lux/ledger';
import type * as schema from '../schema';

export const toTransactionEntity = (
  row: typeof schema.transactions.$inferSelect,
  entries: EntryEntity[],
): TransactionEntity =>
  new TransactionEntity({
    id: new TransactionId(row.id),
    tenantId: row.tenantId,
    ledgerId: new LedgerId(row.ledgerId),
    reference: row.reference,
    currency: row.currency,
    description: row.description,
    relatedTransactionId: row.relatedTransactionId,
    relationType: row.relationType,
    createdAt: row.createdAt,
    effectiveAt: row.effectiveAt,
    entries,
  });
