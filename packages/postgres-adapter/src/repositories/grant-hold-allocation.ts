import { InvariantViolationError } from '@luxledger/core/application';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleDatabase } from '../client';
import * as schema from '../schema';

type Tx = DrizzleDatabase;

const activeReservationsByGrant = async (
  tx: Tx,
  tenantId: string,
  grantIds: string[],
): Promise<Map<string, bigint>> => {
  if (grantIds.length === 0) return new Map();
  const rows = await tx.execute<{ grantId: string; amountMinor: string }>(sql`
    select reserved."grantId", sum(reserved.allocated - reserved.consumed)::text as "amountMinor"
    from (
      select allocation.grant_id as "grantId", hold.id as "holdId",
        sum(allocation.amount_minor) as allocated,
        coalesce((
          select sum(lineage.amount_minor)
          from credit_grant_entries lineage
          join entries entry on entry.id = lineage.entry_id and entry.tenant_id = lineage.tenant_id
          join transactions transaction on transaction.id = entry.transaction_id
            and transaction.tenant_id = entry.tenant_id
          where lineage.tenant_id = ${tenantId}
            and lineage.grant_id = allocation.grant_id
            and lineage.kind = 'CONSUMPTION'
            and transaction.hold_id = hold.id
        ), 0) as consumed
      from credit_grant_hold_allocations allocation
      join hold_entries hold_entry on hold_entry.id = allocation.hold_entry_id
        and hold_entry.tenant_id = allocation.tenant_id
      join holds hold on hold.id = hold_entry.hold_id and hold.tenant_id = hold_entry.tenant_id
      where allocation.tenant_id = ${tenantId}
        and allocation.grant_id in (${sql.join(
          grantIds.map((grantId) => sql`${grantId}`),
          sql`, `,
        )})
        and hold.state = 'HELD'
      group by allocation.grant_id, hold.id
    ) reserved
    group by reserved."grantId"
  `);
  return new Map(rows.map((row) => [row.grantId, BigInt(row.amountMinor)]));
};

export const getActiveGrantReservations = activeReservationsByGrant;

export const allocateGrantCapacityForHold = async (
  tx: Tx,
  input: {
    tenantId: string;
    ledgerId: string;
    accountId: string;
    holdEntryId: string;
    amountMinor: bigint;
  },
): Promise<void> => {
  const grants = await tx
    .select({
      id: schema.creditGrants.id,
      expiresAt: schema.creditGrants.expiresAt,
    })
    .from(schema.creditGrants)
    .where(
      and(
        eq(schema.creditGrants.tenantId, input.tenantId),
        eq(schema.creditGrants.ledgerId, input.ledgerId),
        eq(schema.creditGrants.accountId, input.accountId),
        sql`${schema.creditGrants.expiresAt} is null or ${schema.creditGrants.expiresAt} > transaction_timestamp()`,
      ),
    )
    .orderBy(
      sql`${schema.creditGrants.expiresAt} asc nulls last`,
      asc(schema.creditGrants.createdAt),
      asc(schema.creditGrants.id),
    )
    .for('update');
  const capacities =
    grants.length === 0
      ? []
      : await tx
          .selectDistinctOn([schema.creditGrantCapacityVersions.grantId], {
            grantId: schema.creditGrantCapacityVersions.grantId,
            remainingMinor: schema.creditGrantCapacityVersions.remainingMinor,
          })
          .from(schema.creditGrantCapacityVersions)
          .where(
            and(
              eq(schema.creditGrantCapacityVersions.tenantId, input.tenantId),
              inArray(
                schema.creditGrantCapacityVersions.grantId,
                grants.map((grant) => grant.id),
              ),
            ),
          )
          .orderBy(
            schema.creditGrantCapacityVersions.grantId,
            desc(schema.creditGrantCapacityVersions.version),
          );
  const capacityByGrant = new Map(
    capacities.map((capacity) => [capacity.grantId, capacity.remainingMinor]),
  );
  const reservedByGrant = await activeReservationsByGrant(
    tx,
    input.tenantId,
    grants.map((grant) => grant.id),
  );
  let required = input.amountMinor;
  const allocations: Array<typeof schema.creditGrantHoldAllocations.$inferInsert> = [];
  for (const grant of grants) {
    const available = (capacityByGrant.get(grant.id) ?? 0n) - (reservedByGrant.get(grant.id) ?? 0n);
    if (available <= 0n) continue;
    const amountMinor = available < required ? available : required;
    allocations.push({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      accountId: input.accountId,
      grantId: grant.id,
      holdEntryId: input.holdEntryId,
      amountMinor,
    });
    required -= amountMinor;
    if (required === 0n) break;
  }
  if (required !== 0n) {
    throw new InvariantViolationError('Unable to create hold: insufficient credit grant capacity');
  }
  await tx.insert(schema.creditGrantHoldAllocations).values(allocations);
};

export const attachReservedGrantConsumption = async (
  tx: Tx,
  input: {
    tenantId: string;
    ledgerId: string;
    holdId: string;
    entries: Array<{
      id: string;
      accountId: string;
      signedAmountMinor: bigint;
    }>;
  },
): Promise<void> => {
  const debitEntries = input.entries.filter((entry) => entry.signedAmountMinor > 0n);
  for (const entry of debitEntries) {
    const allocations = await tx
      .select({
        grantId: schema.creditGrantHoldAllocations.grantId,
        amountMinor: schema.creditGrantHoldAllocations.amountMinor,
      })
      .from(schema.creditGrantHoldAllocations)
      .innerJoin(
        schema.holdEntries,
        eq(schema.creditGrantHoldAllocations.holdEntryId, schema.holdEntries.id),
      )
      .innerJoin(
        schema.creditGrants,
        eq(schema.creditGrantHoldAllocations.grantId, schema.creditGrants.id),
      )
      .where(
        and(
          eq(schema.creditGrantHoldAllocations.tenantId, input.tenantId),
          eq(schema.holdEntries.holdId, input.holdId),
          eq(schema.creditGrantHoldAllocations.accountId, entry.accountId),
        ),
      )
      .orderBy(
        sql`${schema.creditGrants.expiresAt} asc nulls last`,
        asc(schema.creditGrants.createdAt),
        asc(schema.creditGrants.id),
      )
      .for('update');
    if (allocations.length === 0) continue;
    const allocationByGrant = new Map<string, bigint>();
    for (const allocation of allocations) {
      allocationByGrant.set(
        allocation.grantId,
        (allocationByGrant.get(allocation.grantId) ?? 0n) + allocation.amountMinor,
      );
    }

    const consumed = await tx
      .select({
        grantId: schema.creditGrantEntries.grantId,
        amountMinor: sql<bigint>`sum(${schema.creditGrantEntries.amountMinor})`,
      })
      .from(schema.creditGrantEntries)
      .innerJoin(schema.entries, eq(schema.creditGrantEntries.entryId, schema.entries.id))
      .innerJoin(schema.transactions, eq(schema.entries.transactionId, schema.transactions.id))
      .where(
        and(
          eq(schema.creditGrantEntries.tenantId, input.tenantId),
          eq(schema.creditGrantEntries.accountId, entry.accountId),
          eq(schema.creditGrantEntries.kind, 'CONSUMPTION'),
          eq(schema.transactions.holdId, input.holdId),
        ),
      )
      .groupBy(schema.creditGrantEntries.grantId);
    const consumedByGrant = new Map(consumed.map((row) => [row.grantId, row.amountMinor]));
    let required = entry.signedAmountMinor;
    const lineage: Array<typeof schema.creditGrantEntries.$inferInsert> = [];
    for (const [grantId, allocatedMinor] of allocationByGrant) {
      const available = allocatedMinor - (consumedByGrant.get(grantId) ?? 0n);
      if (available <= 0n) continue;
      const amountMinor = available < required ? available : required;
      lineage.push({
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        accountId: entry.accountId,
        grantId,
        entryId: entry.id,
        kind: 'CONSUMPTION',
        amountMinor,
      });
      required -= amountMinor;
      if (required === 0n) break;
    }
    if (required !== 0n) {
      throw new InvariantViolationError('Unable to commit hold: grant reservation is missing');
    }
    await tx.insert(schema.creditGrantEntries).values(lineage);
  }
};
