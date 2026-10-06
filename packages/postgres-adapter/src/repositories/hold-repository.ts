import { aggregateAccountEntries, parseAccountSide } from '@luxledger/core';
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
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DbClient } from '../client';
import * as schema from '../schema';
import { findGrantEnabledAccountsForMutation } from './account-mutation-lock';
import { insertBalanceSnapshot } from './balance-snapshot';
import { totalDebit, validatePosting } from './posting-validation';

type HoldRow = typeof schema.holds.$inferSelect;

export class DrizzleHoldRepository implements HoldApplicationRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: CreateHoldInput): Promise<CreateHoldResult> {
    return this.client.runTenantTx(input.tenantId, 'create hold', async (tx) => {
      await validatePosting(tx, input);
      const grantEnabledAccounts = await findGrantEnabledAccountsForMutation(
        tx,
        input.tenantId,
        input.entries.map((entry) => entry.accountId),
      );
      if (grantEnabledAccounts.length > 0) {
        throw new InvariantViolationError('Grant-enabled account holds require grant allocation');
      }
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
            signedAmountMinor: schema.holdEntries.signedAmountMinor,
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
          signedAmountMinor: entry.signedAmountMinor,
          currency: entry.currency,
          assetId: asset.id,
        })),
      );

      for (const entry of aggregateAccountEntries(input.entries)) {
        const reservationDeltaMinor = sql<bigint>`case
          when ${schema.accounts.side} = 'DEBIT' then ${-entry.creditMinor}
          else ${entry.debitMinor}
        end`;
        const [updatedAccount] = await tx
          .update(schema.accounts)
          .set({
            reservedDeltaMinor: sql`${schema.accounts.reservedDeltaMinor} + ${reservationDeltaMinor}`,
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
            side: schema.accounts.side,
            overdraftPolicy: schema.accounts.overdraftPolicy,
            balanceMinor: schema.accounts.balanceMinor,
            reservedDeltaMinor: schema.accounts.reservedDeltaMinor,
          });
        if (!updatedAccount) {
          throw new InvariantViolationError(
            'Unable to create hold: account ledger/currency mismatch',
          );
        }
        assertAvailableBalance({ ...updatedAccount, side: parseAccountSide(updatedAccount.side) });
        await insertBalanceSnapshot(tx, {
          tenantId: input.tenantId,
          eventType: 'HOLD_CREATED',
          sourceId: insertedHold.id,
          accountId: updatedAccount.id,
          ledgerId: updatedAccount.ledgerId,
          postedMinor: updatedAccount.balanceMinor,
          reservedDeltaMinor: updatedAccount.reservedDeltaMinor,
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
            .select({ signedAmountMinor: schema.entries.signedAmountMinor })
            .from(schema.entries)
            .where(
              and(
                eq(schema.entries.tenantId, input.tenantId),
                eq(schema.entries.transactionId, existingTransaction.id),
                sql`${schema.entries.signedAmountMinor} > 0`,
              ),
            );
          const committedAmount = committedDebits.reduce(
            (sum, entry) => sum + entry.signedAmountMinor,
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
        const scaled = entry.signedAmountMinor * commitAmount;
        if (scaled % hold.originalAmountMinor !== 0n) {
          throw new InvariantViolationError(
            'Unable to commit hold: amount cannot be represented without rounding',
          );
        }
        const signedAmountMinor = scaled / hold.originalAmountMinor;
        if (signedAmountMinor === 0n) {
          throw new InvariantViolationError('Unable to commit hold: amount produced zero entry');
        }
        return {
          tenantId: input.tenantId,
          transactionId: insertedTransaction.id,
          accountId: entry.accountId,
          signedAmountMinor,
          currency: entry.currency,
          assetId: hold.assetId,
        };
      });

      await tx.insert(schema.entries).values(committedEntries);

      for (const entry of aggregateAccountEntries(committedEntries)) {
        const delta = entry.signedAmountMinor;
        const reservationDeltaMinor = sql<bigint>`case
          when ${schema.accounts.side} = 'DEBIT' then ${-entry.creditMinor}
          else ${entry.debitMinor}
        end`;
        const [updatedAccount] = await tx
          .update(schema.accounts)
          .set({
            balanceMinor: sql`${schema.accounts.balanceMinor} + ${delta}`,
            reservedDeltaMinor: sql`${schema.accounts.reservedDeltaMinor} - ${reservationDeltaMinor}`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
              eq(schema.accounts.ledgerId, hold.ledgerId),
              eq(schema.accounts.currency, hold.currency),
              sql`(
                (${schema.accounts.side} = 'DEBIT' and ${schema.accounts.reservedDeltaMinor} <= ${reservationDeltaMinor})
                or
                (${schema.accounts.side} = 'CREDIT' and ${schema.accounts.reservedDeltaMinor} >= ${reservationDeltaMinor})
              )`,
            ),
          )
          .returning({
            id: schema.accounts.id,
            ledgerId: schema.accounts.ledgerId,
            side: schema.accounts.side,
            overdraftPolicy: schema.accounts.overdraftPolicy,
            balanceMinor: schema.accounts.balanceMinor,
            reservedDeltaMinor: schema.accounts.reservedDeltaMinor,
          });
        if (!updatedAccount) {
          throw new InvariantViolationError(
            'Unable to commit hold: account reservation is missing',
          );
        }
        assertAvailableBalance({ ...updatedAccount, side: parseAccountSide(updatedAccount.side) });
        await insertBalanceSnapshot(tx, {
          tenantId: input.tenantId,
          eventType: 'HOLD_COMMITTED',
          sourceId: hold.id,
          accountId: updatedAccount.id,
          ledgerId: updatedAccount.ledgerId,
          postedMinor: updatedAccount.balanceMinor,
          reservedDeltaMinor: updatedAccount.reservedDeltaMinor,
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
          signedAmountMinor: this.remainingEntryAmount(entry.signedAmountMinor, hold),
        })),
      );
      if (
        releases.reduce((sum, entry) => sum + entry.debitMinor, 0n) !== hold.remainingAmountMinor ||
        releases.reduce((sum, entry) => sum + entry.creditMinor, 0n) !== hold.remainingAmountMinor
      ) {
        throw new InvariantViolationError('Unable to void hold: reservation totals do not match');
      }
      for (const entry of releases) {
        const reservationDeltaMinor = sql<bigint>`case
          when ${schema.accounts.side} = 'DEBIT' then ${-entry.creditMinor}
          else ${entry.debitMinor}
        end`;
        const [updated] = await tx
          .update(schema.accounts)
          .set({
            reservedDeltaMinor: sql`${schema.accounts.reservedDeltaMinor} - ${reservationDeltaMinor}`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.accounts.id, entry.accountId),
              eq(schema.accounts.tenantId, input.tenantId),
              eq(schema.accounts.ledgerId, hold.ledgerId),
              eq(schema.accounts.currency, hold.currency),
              sql`(
                (${schema.accounts.side} = 'DEBIT' and ${schema.accounts.reservedDeltaMinor} <= ${reservationDeltaMinor})
                or
                (${schema.accounts.side} = 'CREDIT' and ${schema.accounts.reservedDeltaMinor} >= ${reservationDeltaMinor})
              )`,
            ),
          )
          .returning({
            id: schema.accounts.id,
            ledgerId: schema.accounts.ledgerId,
            balanceMinor: schema.accounts.balanceMinor,
            reservedDeltaMinor: schema.accounts.reservedDeltaMinor,
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
          reservedDeltaMinor: updated.reservedDeltaMinor,
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
      signedAmountMinor: bigint;
      currency: string;
    }>,
    inputEntries: Array<{
      accountId: string;
      signedAmountMinor: bigint;
      currency: string;
    }>,
  ): boolean {
    if (existingEntries.length !== inputEntries.length) {
      return false;
    }
    const normalize = (
      entries: Array<{
        accountId: string;
        signedAmountMinor: bigint;
        currency: string;
      }>,
    ) =>
      entries
        .map(
          (entry) => `${entry.accountId}:${entry.signedAmountMinor.toString()}:${entry.currency}`,
        )
        .sort();

    const existing = normalize(existingEntries);
    const input = normalize(inputEntries);
    return existing.every((value, index) => value === input[index]);
  }

  private remainingEntryAmount(signedAmountMinor: bigint, hold: HoldRow): bigint {
    const scaled = signedAmountMinor * hold.remainingAmountMinor;
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
