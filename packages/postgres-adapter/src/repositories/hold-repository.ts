import { aggregateAccountEntries, type EntryDirection } from '@luxledger/core';
import {
  assertAvailableBalance,
  type CommitHoldInput,
  type CommitHoldResult,
  type CreateHoldInput,
  type CreateHoldResult,
  type HoldApplicationRepository,
  InvariantViolationError,
  RepositoryError,
  type VoidHoldInput,
  type VoidHoldResult,
} from '@luxledger/core/application';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
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
      const [asset] = await tx
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(
          and(eq(schema.assets.tenantId, input.tenantId), eq(schema.assets.code, input.currency)),
        )
        .limit(1);
      if (!asset) throw new InvariantViolationError('Asset must be created before hold');

      const amountMinor = totalDebit(input.entries);
      const [insertedHold] = await tx
        .insert(schema.holds)
        .values({
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          reference: input.reference,
          currency: input.currency,
          assetId: asset.id,
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
          assetId: asset.id,
        })),
      );

      for (const entry of aggregateAccountEntries(input.entries)) {
        const [updatedAccount] = await tx
          .update(schema.accounts)
          .set({
            inflightDebitMinor: sql`${schema.accounts.inflightDebitMinor} + ${entry.debitMinor}`,
            inflightCreditMinor: sql`${schema.accounts.inflightCreditMinor} + ${entry.creditMinor}`,
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
        const [creditGrant] = await tx
          .select({ id: schema.creditGrants.id })
          .from(schema.creditGrants)
          .where(
            and(
              eq(schema.creditGrants.tenantId, input.tenantId),
              eq(schema.creditGrants.accountId, entry.accountId),
            ),
          )
          .limit(1);
        if (creditGrant) {
          throw new InvariantViolationError('Credit account holds require grant allocation');
        }
        assertAvailableBalance(updatedAccount);
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
        .select({ id: schema.transactions.id, holdId: schema.transactions.holdId })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.tenantId, input.tenantId),
            eq(schema.transactions.reference, input.reference),
          ),
        )
        .limit(1);
      if (existingTransaction) {
        if (existingTransaction.holdId !== input.holdId) {
          throw new InvariantViolationError(
            'Unable to commit hold: reference belongs to different transaction',
          );
        }
        if (input.amountMinor !== undefined) {
          const committedDebits = await tx
            .select({ amountMinor: schema.entries.amountMinor })
            .from(schema.entries)
            .where(
              and(
                eq(schema.entries.tenantId, input.tenantId),
                eq(schema.entries.transactionId, existingTransaction.id),
                eq(schema.entries.direction, 'DEBIT'),
              ),
            );
          const committedAmount = committedDebits.reduce(
            (sum, entry) => sum + entry.amountMinor,
            0n,
          );
          if (committedAmount !== input.amountMinor) {
            throw new InvariantViolationError('Unable to commit hold: reference amount mismatch');
          }
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
      this.assertHeldAmount(hold, 'commit');

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
      if (holdEntries.some((entry) => entry.currency !== hold.currency)) {
        throw new InvariantViolationError('Unable to commit hold: entry currency mismatch');
      }

      const [insertedTransaction] = await tx
        .insert(schema.transactions)
        .values({
          tenantId: hold.tenantId,
          ledgerId: hold.ledgerId,
          holdId: hold.id,
          reference: input.reference,
          currency: hold.currency,
          assetId: hold.assetId,
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
          assetId: hold.assetId,
        };
      });

      await tx.insert(schema.entries).values(committedEntries);

      for (const entry of aggregateAccountEntries(committedEntries)) {
        const delta = entry.creditMinor - entry.debitMinor;
        const [updatedAccount] = await tx
          .update(schema.accounts)
          .set({
            balanceMinor: sql`${schema.accounts.balanceMinor} + ${delta}`,
            inflightDebitMinor: sql`${schema.accounts.inflightDebitMinor} - ${entry.debitMinor}`,
            inflightCreditMinor: sql`${schema.accounts.inflightCreditMinor} - ${entry.creditMinor}`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
              eq(schema.accounts.ledgerId, hold.ledgerId),
              eq(schema.accounts.currency, hold.currency),
              gte(schema.accounts.inflightDebitMinor, entry.debitMinor),
              gte(schema.accounts.inflightCreditMinor, entry.creditMinor),
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
            'Unable to commit hold: account reservation is missing',
          );
        }
        assertAvailableBalance(updatedAccount);
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
      this.assertHeldAmount(hold, 'void');

      const holdEntries = await tx
        .select()
        .from(schema.holdEntries)
        .where(
          and(
            eq(schema.holdEntries.tenantId, input.tenantId),
            eq(schema.holdEntries.holdId, input.holdId),
          ),
        );
      if (holdEntries.length < 2) {
        throw new InvariantViolationError('Unable to void hold: hold entries are missing');
      }
      if (holdEntries.some((entry) => entry.currency !== hold.currency)) {
        throw new InvariantViolationError('Unable to void hold: entry currency mismatch');
      }
      const releases = aggregateAccountEntries(
        holdEntries.map((entry) => ({
          accountId: entry.accountId,
          direction: entry.direction,
          amountMinor: this.remainingEntryAmount(entry.amountMinor, hold),
        })),
      );
      if (
        releases.reduce((sum, entry) => sum + entry.debitMinor, 0n) !== hold.remainingAmountMinor ||
        releases.reduce((sum, entry) => sum + entry.creditMinor, 0n) !== hold.remainingAmountMinor
      ) {
        throw new InvariantViolationError('Unable to void hold: reservation totals do not match');
      }
      for (const entry of releases) {
        const [updated] = await tx
          .update(schema.accounts)
          .set({
            inflightDebitMinor: sql`${schema.accounts.inflightDebitMinor} - ${entry.debitMinor}`,
            inflightCreditMinor: sql`${schema.accounts.inflightCreditMinor} - ${entry.creditMinor}`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
              eq(schema.accounts.ledgerId, hold.ledgerId),
              eq(schema.accounts.currency, hold.currency),
              gte(schema.accounts.inflightDebitMinor, entry.debitMinor),
              gte(schema.accounts.inflightCreditMinor, entry.creditMinor),
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
          throw new InvariantViolationError('Unable to void hold: account reservation is missing');
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

  private remainingEntryAmount(amountMinor: bigint, hold: HoldRow): bigint {
    const scaled = amountMinor * hold.remainingAmountMinor;
    if (scaled % hold.originalAmountMinor !== 0n) {
      throw new InvariantViolationError(
        'Unable to void hold: reservation cannot be released exactly',
      );
    }
    return scaled / hold.originalAmountMinor;
  }

  private assertHeldAmount(hold: HoldRow, operation: 'commit' | 'void'): void {
    if (
      hold.originalAmountMinor <= 0n ||
      hold.remainingAmountMinor <= 0n ||
      hold.remainingAmountMinor > hold.originalAmountMinor
    ) {
      throw new InvariantViolationError(
        `Unable to ${operation} hold: invalid remaining reservation`,
      );
    }
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
