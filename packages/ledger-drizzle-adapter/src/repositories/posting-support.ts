import {
  AccountId,
  CreateTransactionUseCase,
  DomainError,
  EntryDirection,
  LedgerId,
} from '@lux/ledger';
import { type CreateTransactionInput, InvariantViolationError } from '@lux/ledger/application';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateUuidV7 } from '../repository-context';
import * as schema from '../schema';

type BalanceSnapshotEventType = typeof schema.balanceSnapshots.$inferSelect.eventType;

export class DrizzlePostingSupport {
  public async validateTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    input: CreateTransactionInput,
  ): Promise<void> {
    const useCase = new CreateTransactionUseCase({
      findAccounts: async (tenantId, accountIds) => {
        const uniqueIds = [...new Set(accountIds.map((accountId) => accountId.value))];
        if (uniqueIds.length === 0) {
          return [];
        }
        const rows = await tx
          .select({
            id: schema.accounts.id,
            ledgerId: schema.accounts.ledgerId,
            currency: schema.accounts.currency,
          })
          .from(schema.accounts)
          .where(
            and(eq(schema.accounts.tenantId, tenantId), inArray(schema.accounts.id, uniqueIds)),
          );
        return rows.map((row) => ({
          id: new AccountId(row.id),
          ledgerId: new LedgerId(row.ledgerId),
          currency: row.currency,
        }));
      },
    });

    try {
      await useCase.execute({
        tenantId: input.tenantId,
        id: generateUuidV7(),
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        description: input.description ?? null,
        entries: input.entries,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        throw new InvariantViolationError(error.message, { cause: error });
      }
      throw error;
    }
  }

  public async insertBalanceSnapshot(
    tx: PostgresJsDatabase<typeof schema>,
    row: {
      tenantId: string;
      ledgerId: string;
      accountId: string;
      eventType: BalanceSnapshotEventType;
      sourceId: string;
      postedMinor: bigint;
      inflightDebitMinor: bigint;
      inflightCreditMinor: bigint;
      effectiveAt?: Date;
    },
  ): Promise<void> {
    await tx
      .insert(schema.balanceSnapshots)
      .values({
        tenantId: row.tenantId,
        ledgerId: row.ledgerId,
        accountId: row.accountId,
        eventType: row.eventType,
        sourceId: row.sourceId,
        postedMinor: row.postedMinor,
        inflightDebitMinor: row.inflightDebitMinor,
        inflightCreditMinor: row.inflightCreditMinor,
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
  }

  public validateEntries(
    entries: Array<{
      direction: EntryDirection;
      amountMinor: bigint;
      currency: string;
    }>,
    currency: string,
  ): void {
    if (entries.length < 2) {
      throw new InvariantViolationError('Unable to create hold: at least two entries are required');
    }
    const hasDebit = entries.some((entry) => entry.direction === EntryDirection.DEBIT);
    const hasCredit = entries.some((entry) => entry.direction === EntryDirection.CREDIT);
    if (!hasDebit || !hasCredit) {
      throw new InvariantViolationError(
        'Unable to create hold: entries must include at least one DEBIT and one CREDIT',
      );
    }
    for (const entry of entries) {
      if (entry.currency !== currency) {
        throw new InvariantViolationError(
          'Unable to create hold: entry currency must match hold currency',
        );
      }
    }
  }

  public totalDebit(entries: Array<{ direction: EntryDirection; amountMinor: bigint }>): bigint {
    return entries.reduce(
      (sum, entry) => (entry.direction === EntryDirection.DEBIT ? sum + entry.amountMinor : sum),
      0n,
    );
  }
}
