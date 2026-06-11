import type { EntryEntity } from '@lux/ledger';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { toEntryEntity } from '../mappers/entry-mapper';
import * as schema from '../schema';

export const loadEntriesByTransactionIds = async (
  tx: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  transactionIds: string[],
): Promise<Map<string, EntryEntity[]>> => {
  if (transactionIds.length === 0) {
    return new Map();
  }

  const rows = await tx
    .select()
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.tenantId, tenantId),
        inArray(schema.entries.transactionId, transactionIds),
      ),
    )
    .orderBy(asc(schema.entries.createdAt), asc(schema.entries.id));

  const byTransactionId = new Map<string, EntryEntity[]>();
  for (const row of rows) {
    const entries = byTransactionId.get(row.transactionId) ?? [];
    entries.push(toEntryEntity(row));
    byTransactionId.set(row.transactionId, entries);
  }
  return byTransactionId;
};
