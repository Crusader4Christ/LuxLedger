import { LedgerEntity } from '@lux/ledger';
import type * as schema from '../schema';

export const toLedgerEntity = (row: typeof schema.ledgers.$inferSelect): LedgerEntity =>
  new LedgerEntity({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
