import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DrizzleDatabase } from '../client';
import * as schema from '../schema';

export const lockAccountsForMutation = async (
  tx: DrizzleDatabase,
  tenantId: string,
  accountIds: string[],
): Promise<Array<typeof schema.accounts.$inferSelect>> => {
  const orderedIds = [...new Set(accountIds)].sort();
  if (orderedIds.length === 0) return [];

  return tx
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.tenantId, tenantId), inArray(schema.accounts.id, orderedIds)))
    .orderBy(asc(schema.accounts.id))
    .for('update');
};
