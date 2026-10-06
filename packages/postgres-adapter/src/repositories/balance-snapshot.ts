import type { DrizzleDatabase } from '../client';
import * as schema from '../schema';

type BalanceSnapshotEventType = typeof schema.balanceSnapshots.$inferSelect.eventType;

export const insertBalanceSnapshot = async (
  tx: DrizzleDatabase,
  row: {
    tenantId: string;
    ledgerId: string;
    accountId: string;
    eventType: BalanceSnapshotEventType;
    sourceId: string;
    postedMinor: bigint;
    reservedDeltaMinor: bigint;
    effectiveAt?: Date;
  },
): Promise<void> => {
  await tx
    .insert(schema.balanceSnapshots)
    .values({
      tenantId: row.tenantId,
      ledgerId: row.ledgerId,
      accountId: row.accountId,
      eventType: row.eventType,
      sourceId: row.sourceId,
      postedMinor: row.postedMinor,
      reservedDeltaMinor: row.reservedDeltaMinor,
      effectiveAt: row.effectiveAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [
        schema.balanceSnapshots.tenantId,
        schema.balanceSnapshots.eventType,
        schema.balanceSnapshots.sourceId,
        schema.balanceSnapshots.accountId,
      ],
    });
};
