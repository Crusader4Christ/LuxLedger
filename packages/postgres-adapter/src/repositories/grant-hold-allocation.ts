import { InvariantViolationError } from '@luxledger/core/application';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DrizzleDatabase } from '../client';
import * as schema from '../schema';
import {
  availableCapacityByGrant,
  type GrantCapacityRow,
  grantCapacityQuery,
} from './grant-capacity-query';

type Tx = DrizzleDatabase;

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
      : await tx.execute<GrantCapacityRow>(
          grantCapacityQuery(
            input.tenantId,
            grants.map((grant) => grant.id),
          ),
        );
  const capacityByGrant = availableCapacityByGrant(capacities);
  let required = input.amountMinor;
  const allocations: Array<typeof schema.creditGrantHoldAllocations.$inferInsert> = [];
  for (const grant of grants) {
    const available = capacityByGrant.get(grant.id) ?? 0n;
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
      // Provenance is immutable; serialize consumption on the grant, not the joined history.
      .for('update', { of: schema.creditGrants });
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
        amountMinor: sql`sum(${schema.creditGrantEntries.amountMinor})`.mapWith(BigInt),
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
