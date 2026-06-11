import { EntryDirection } from '@lux/ledger';
import {
  type CommitHoldInput,
  type CommitHoldResult,
  type CreateHoldInput,
  type CreateHoldResult,
  type HoldApplicationRepository,
  InvariantViolationError,
  OverdraftPolicyViolationError,
  RepositoryError,
  type VoidHoldInput,
  type VoidHoldResult,
} from '@lux/ledger/application';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DbClient } from '../client';
import * as schema from '../schema';
import { insertBalanceSnapshot } from './balance-snapshot';
import { totalDebit, validatePosting } from './posting-validation';

type HoldRow = typeof schema.holds.$inferSelect;

export class DrizzleHoldRepository implements HoldApplicationRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: CreateHoldInput): Promise<CreateHoldResult> {
    return this.client.runTenantTx(input.tenantId, 'create hold', async (tx) => {
      await validatePosting(tx, input);

      const amountMinor = totalDebit(input.entries);
      const [insertedHold] = await tx
        .insert(schema.holds)
        .values({
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          reference: input.reference,
          currency: input.currency,
          description: input.description ?? null,
          originalAmountMinor: amountMinor,
          remainingAmountMinor: amountMinor,
        })
        .onConflictDoNothing({
          target: [schema.holds.tenantId, schema.holds.reference],
        })
        .returning({
          id: schema.holds.id,
          state: schema.holds.state,
          remainingAmountMinor: schema.holds.remainingAmountMinor,
        });

      if (!insertedHold) {
        const [existingHold] = await tx
          .select({
            id: schema.holds.id,
            ledgerId: schema.holds.ledgerId,
            currency: schema.holds.currency,
            description: schema.holds.description,
            state: schema.holds.state,
            remainingAmountMinor: schema.holds.remainingAmountMinor,
          })
          .from(schema.holds)
          .where(
            and(
              eq(schema.holds.tenantId, input.tenantId),
              eq(schema.holds.reference, input.reference),
            ),
          )
          .limit(1);
        if (!existingHold) {
          throw new RepositoryError(
            `Unable to resolve idempotent hold for tenant ${input.tenantId} and reference ${input.reference}`,
          );
        }
        if (
          existingHold.ledgerId !== input.ledgerId ||
          existingHold.currency !== input.currency ||
          (existingHold.description ?? null) !== (input.description ?? null)
        ) {
          throw new InvariantViolationError('Unable to create hold: reference payload mismatch');
        }
        const existingEntries = await tx
          .select({
            accountId: schema.holdEntries.accountId,
            direction: schema.holdEntries.direction,
            amountMinor: schema.holdEntries.amountMinor,
            currency: schema.holdEntries.currency,
          })
          .from(schema.holdEntries)
          .where(
            and(
              eq(schema.holdEntries.tenantId, input.tenantId),
              eq(schema.holdEntries.holdId, existingHold.id),
            ),
          );
        if (!this.areEquivalentHoldEntries(existingEntries, input.entries)) {
          throw new InvariantViolationError('Unable to create hold: reference payload mismatch');
        }
        return {
          holdId: existingHold.id,
          created: false,
          state: existingHold.state,
          remainingAmountMinor: existingHold.remainingAmountMinor,
        } satisfies CreateHoldResult;
      }

      await tx.insert(schema.holdEntries).values(
        input.entries.map((entry) => ({
          tenantId: input.tenantId,
          holdId: insertedHold.id,
          accountId: entry.accountId,
          direction: entry.direction,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        })),
      );

      for (const entry of [...input.entries].sort((a, b) =>
        a.accountId.localeCompare(b.accountId),
      )) {
        const [updatedAccount] = await tx
          .update(schema.accounts)
          .set({
            inflightDebitMinor:
              entry.direction === EntryDirection.DEBIT
                ? sql`${schema.accounts.inflightDebitMinor} + ${entry.amountMinor}`
                : schema.accounts.inflightDebitMinor,
            inflightCreditMinor:
              entry.direction === EntryDirection.CREDIT
                ? sql`${schema.accounts.inflightCreditMinor} + ${entry.amountMinor}`
                : schema.accounts.inflightCreditMinor,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
              eq(schema.accounts.ledgerId, input.ledgerId),
              eq(schema.accounts.currency, input.currency),
            ),
          )
          .returning({
            id: schema.accounts.id,
            ledgerId: schema.accounts.ledgerId,
            overdraftPolicy: schema.accounts.overdraftPolicy,
            balanceMinor: schema.accounts.balanceMinor,
            inflightDebitMinor: schema.accounts.inflightDebitMinor,
            inflightCreditMinor: schema.accounts.inflightCreditMinor,
          });
        if (!updatedAccount) {
          throw new InvariantViolationError(
            'Unable to create hold: account ledger/currency mismatch',
          );
        }
        await insertBalanceSnapshot(tx, {
          tenantId: input.tenantId,
          eventType: 'HOLD_CREATED',
          sourceId: insertedHold.id,
          accountId: updatedAccount.id,
          ledgerId: updatedAccount.ledgerId,
          postedMinor: updatedAccount.balanceMinor,
          inflightDebitMinor: updatedAccount.inflightDebitMinor,
          inflightCreditMinor: updatedAccount.inflightCreditMinor,
        });
      }

      return {
        holdId: insertedHold.id,
        created: true,
        state: insertedHold.state,
        remainingAmountMinor: insertedHold.remainingAmountMinor,
      } satisfies CreateHoldResult;
    });
  }

  public async commit(input: CommitHoldInput): Promise<CommitHoldResult> {
    return this.client.runTenantTx(input.tenantId, 'commit hold', async (tx) => {
      const hold = await this.lockHold(tx, input.tenantId, input.holdId);
      if (!hold) {
        throw new InvariantViolationError('Unable to commit hold: hold not found');
      }

      const [existingTransaction] = await tx
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.tenantId, input.tenantId),
            eq(schema.transactions.reference, input.reference),
          ),
        )
        .limit(1);
      if (existingTransaction) {
        const [sameHold] = await tx
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.id, existingTransaction.id),
              eq(schema.transactions.holdId, input.holdId),
            ),
          )
          .limit(1);
        if (!sameHold) {
          throw new InvariantViolationError(
            'Unable to commit hold: reference belongs to different transaction',
          );
        }
        return {
          holdId: hold.id,
          state: hold.state === 'APPLIED' ? 'APPLIED' : 'HELD',
          remainingAmountMinor: hold.remainingAmountMinor,
          transactionId: existingTransaction.id,
          created: false,
        } satisfies CommitHoldResult;
      }
      if (hold.state !== 'HELD') {
        throw new InvariantViolationError(
          `Unable to commit hold: invalid hold state ${hold.state}`,
        );
      }

      const commitAmount = input.amountMinor ?? hold.remainingAmountMinor;
      if (commitAmount <= 0n) {
        throw new InvariantViolationError('Unable to commit hold: amount must be positive');
      }
      if (commitAmount > hold.remainingAmountMinor) {
        throw new InvariantViolationError('Unable to commit hold: amount exceeds remaining amount');
      }

      const holdEntries = await tx
        .select()
        .from(schema.holdEntries)
        .where(
          and(
            eq(schema.holdEntries.tenantId, input.tenantId),
            eq(schema.holdEntries.holdId, input.holdId),
          ),
        )
        .orderBy(asc(schema.holdEntries.createdAt), asc(schema.holdEntries.id));
      if (holdEntries.length < 2) {
        throw new InvariantViolationError('Unable to commit hold: hold entries are missing');
      }

      const [insertedTransaction] = await tx
        .insert(schema.transactions)
        .values({
          tenantId: hold.tenantId,
          ledgerId: hold.ledgerId,
          holdId: hold.id,
          reference: input.reference,
          currency: hold.currency,
          description: hold.description,
        })
        .returning({ id: schema.transactions.id });

      const committedEntries = holdEntries.map((entry) => {
        const scaled = entry.amountMinor * commitAmount;
        if (scaled % hold.originalAmountMinor !== 0n) {
          throw new InvariantViolationError(
            'Unable to commit hold: amount cannot be represented without rounding',
          );
        }
        const amountMinor = scaled / hold.originalAmountMinor;
        if (amountMinor <= 0n) {
          throw new InvariantViolationError('Unable to commit hold: amount produced zero entry');
        }
        return {
          tenantId: input.tenantId,
          transactionId: insertedTransaction.id,
          accountId: entry.accountId,
          direction: entry.direction,
          amountMinor,
          currency: entry.currency,
        };
      });

      await tx.insert(schema.entries).values(committedEntries);

      for (const entry of committedEntries.sort((a, b) => a.accountId.localeCompare(b.accountId))) {
        const delta =
          entry.direction === EntryDirection.DEBIT ? -entry.amountMinor : entry.amountMinor;
        const [updatedAccount] = await tx
          .update(schema.accounts)
          .set({
            balanceMinor: sql`${schema.accounts.balanceMinor} + ${delta}`,
            inflightDebitMinor:
              entry.direction === EntryDirection.DEBIT
                ? sql`${schema.accounts.inflightDebitMinor} - ${entry.amountMinor}`
                : schema.accounts.inflightDebitMinor,
            inflightCreditMinor:
              entry.direction === EntryDirection.CREDIT
                ? sql`${schema.accounts.inflightCreditMinor} - ${entry.amountMinor}`
                : schema.accounts.inflightCreditMinor,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
            ),
          )
          .returning({
            id: schema.accounts.id,
            ledgerId: schema.accounts.ledgerId,
            overdraftPolicy: schema.accounts.overdraftPolicy,
            balanceMinor: schema.accounts.balanceMinor,
            inflightDebitMinor: schema.accounts.inflightDebitMinor,
            inflightCreditMinor: schema.accounts.inflightCreditMinor,
          });
        if (!updatedAccount) {
          throw new InvariantViolationError('Unable to commit hold: account not found');
        }
        if (updatedAccount.overdraftPolicy === 'DISALLOW' && updatedAccount.balanceMinor < 0n) {
          throw new OverdraftPolicyViolationError(updatedAccount.id, updatedAccount.balanceMinor);
        }
        await insertBalanceSnapshot(tx, {
          tenantId: input.tenantId,
          eventType: 'HOLD_COMMITTED',
          sourceId: hold.id,
          accountId: updatedAccount.id,
          ledgerId: updatedAccount.ledgerId,
          postedMinor: updatedAccount.balanceMinor,
          inflightDebitMinor: updatedAccount.inflightDebitMinor,
          inflightCreditMinor: updatedAccount.inflightCreditMinor,
        });
      }

      const remainingAmountMinor = hold.remainingAmountMinor - commitAmount;
      const [updatedHold] = await tx
        .update(schema.holds)
        .set({
          remainingAmountMinor,
          state: remainingAmountMinor === 0n ? 'APPLIED' : 'HELD',
          appliedAt: remainingAmountMinor === 0n ? sql`now()` : null,
        })
        .where(eq(schema.holds.id, hold.id))
        .returning({
          state: schema.holds.state,
          remainingAmountMinor: schema.holds.remainingAmountMinor,
        });

      return {
        holdId: hold.id,
        state: updatedHold.state as 'HELD' | 'APPLIED',
        remainingAmountMinor: updatedHold.remainingAmountMinor,
        transactionId: insertedTransaction.id,
        created: true,
      } satisfies CommitHoldResult;
    });
  }

  public async void(input: VoidHoldInput): Promise<VoidHoldResult> {
    return this.client.runTenantTx(input.tenantId, 'void hold', async (tx) => {
      const hold = await this.lockHold(tx, input.tenantId, input.holdId);
      if (!hold) {
        throw new InvariantViolationError('Unable to void hold: hold not found');
      }
      if (hold.state === 'VOIDED') {
        return {
          holdId: hold.id,
          state: 'VOIDED',
          remainingAmountMinor: hold.remainingAmountMinor,
          voided: false,
        } satisfies VoidHoldResult;
      }
      if (hold.state !== 'HELD') {
        throw new InvariantViolationError(`Unable to void hold: invalid hold state ${hold.state}`);
      }

      const holdEntries = await tx
        .select()
        .from(schema.holdEntries)
        .where(
          and(
            eq(schema.holdEntries.tenantId, input.tenantId),
            eq(schema.holdEntries.holdId, input.holdId),
          ),
        );
      for (const entry of holdEntries) {
        const releaseAmount =
          (entry.amountMinor * hold.remainingAmountMinor) / hold.originalAmountMinor;
        const [updated] = await tx
          .update(schema.accounts)
          .set({
            inflightDebitMinor:
              entry.direction === EntryDirection.DEBIT
                ? sql`${schema.accounts.inflightDebitMinor} - ${releaseAmount}`
                : schema.accounts.inflightDebitMinor,
            inflightCreditMinor:
              entry.direction === EntryDirection.CREDIT
                ? sql`${schema.accounts.inflightCreditMinor} - ${releaseAmount}`
                : schema.accounts.inflightCreditMinor,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
            ),
          )
          .returning({
            id: schema.accounts.id,
            ledgerId: schema.accounts.ledgerId,
            balanceMinor: schema.accounts.balanceMinor,
            inflightDebitMinor: schema.accounts.inflightDebitMinor,
            inflightCreditMinor: schema.accounts.inflightCreditMinor,
          });
        if (!updated) {
          throw new InvariantViolationError('Unable to void hold: account not found');
        }
        await insertBalanceSnapshot(tx, {
          tenantId: input.tenantId,
          eventType: 'HOLD_VOIDED',
          sourceId: hold.id,
          accountId: updated.id,
          ledgerId: updated.ledgerId,
          postedMinor: updated.balanceMinor,
          inflightDebitMinor: updated.inflightDebitMinor,
          inflightCreditMinor: updated.inflightCreditMinor,
        });
      }

      await tx
        .update(schema.holds)
        .set({
          state: 'VOIDED',
          remainingAmountMinor: 0n,
          voidedAt: sql`now()`,
        })
        .where(eq(schema.holds.id, hold.id));

      return {
        holdId: hold.id,
        state: 'VOIDED',
        remainingAmountMinor: 0n,
        voided: true,
      } satisfies VoidHoldResult;
    });
  }

  private areEquivalentHoldEntries(
    existingEntries: Array<{
      accountId: string;
      direction: string;
      amountMinor: bigint;
      currency: string;
    }>,
    inputEntries: Array<{
      accountId: string;
      direction: EntryDirection;
      amountMinor: bigint;
      currency: string;
    }>,
  ): boolean {
    if (existingEntries.length !== inputEntries.length) {
      return false;
    }
    const normalize = (
      entries: Array<{
        accountId: string;
        direction: string;
        amountMinor: bigint;
        currency: string;
      }>,
    ) =>
      entries
        .map(
          (entry) =>
            `${entry.accountId}:${entry.direction}:${entry.amountMinor.toString()}:${entry.currency}`,
        )
        .sort();

    const existing = normalize(existingEntries);
    const input = normalize(inputEntries);
    return existing.every((value, index) => value === input[index]);
  }

  private async lockHold(
    tx: PostgresJsDatabase<typeof schema>,
    tenantId: string,
    holdId: string,
  ): Promise<HoldRow | null> {
    const [row] = await tx
      .select()
      .from(schema.holds)
      .where(and(eq(schema.holds.tenantId, tenantId), eq(schema.holds.id, holdId)))
      .for('update')
      .limit(1);

    return row ?? null;
  }
}
