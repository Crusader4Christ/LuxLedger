import { creditGrantRemaining, EntryDirection } from '@luxledger/core';
import {
  AccountNotFoundError,
  type CreateCreditGrantInput,
  type CreditBalance,
  type CreditGrant,
  CreditGrantConflictError,
  CreditGrantNotFoundError,
  type CreditGrantRepository,
  type CreditGrantResult,
  type ReverseCreditGrantInput,
} from '@luxledger/core/application';
import { and, eq, sql } from 'drizzle-orm';
import type { DbClient, DrizzleDatabase } from '../client';
import * as schema from '../schema';
import { generateUuidV7 } from '../uuid-v7';
import { DrizzleTransactionRepository } from './transaction-repository';

type GrantRow = typeof schema.creditGrants.$inferSelect;
type Tx = DrizzleDatabase;

export class DrizzleCreditGrantRepository implements CreditGrantRepository {
  private readonly transactions: DrizzleTransactionRepository;

  public constructor(private readonly client: DbClient) {
    this.transactions = new DrizzleTransactionRepository(client);
  }

  public create(input: CreateCreditGrantInput): Promise<CreditGrantResult> {
    return this.client.runTenantTx(input.tenantId, 'create credit grant', async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:grant:${input.reference}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.tenantId, input.tenantId),
            eq(schema.creditGrants.reference, input.reference),
          ),
        )
        .limit(1);
      if (existing) {
        if (!this.samePayload(existing, input)) {
          throw new CreditGrantConflictError('Grant reference payload mismatch');
        }
        return { grant: await this.toGrant(tx, existing), created: false };
      }

      const balance = await this.balanceInTx(tx, input.tenantId, input.accountId);
      if (balance.assetId !== input.assetId) {
        throw new CreditGrantConflictError('Grant asset does not match account asset');
      }
      const [account] = await tx
        .select({ ledgerId: schema.accounts.ledgerId, currency: schema.accounts.currency })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.tenantId, input.tenantId),
            eq(schema.accounts.id, input.accountId),
          ),
        )
        .limit(1);
      if (!account || account.ledgerId !== input.ledgerId) {
        throw new CreditGrantConflictError('Grant account does not belong to ledger');
      }
      const id = generateUuidV7();
      const posted = await this.transactions.createInTx(
        tx,
        {
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          reference: `credit-grant:${id}`,
          currency: account.currency,
          entries: [
            {
              accountId: input.fundingAccountId,
              direction: EntryDirection.DEBIT,
              amountMinor: input.amountMinor,
              currency: account.currency,
            },
            {
              accountId: input.accountId,
              direction: EntryDirection.CREDIT,
              amountMinor: input.amountMinor,
              currency: account.currency,
            },
          ],
        },
        true,
      );
      const [row] = await tx
        .insert(schema.creditGrants)
        .values({
          id,
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          accountId: input.accountId,
          fundingAccountId: input.fundingAccountId,
          assetId: input.assetId,
          reference: input.reference,
          externalReference: input.externalReference ?? null,
          origin: input.origin,
          amountMinor: input.amountMinor,
          refundable: input.policy.refundable,
          transferable: input.policy.transferable,
          consumptionPriority: input.policy.consumptionPriority,
          eligibility: input.policy.eligibility,
          transactionId: posted.transactionId,
        })
        .returning();
      if (!row) throw new CreditGrantConflictError('Grant insert failed');
      return { grant: await this.toGrant(tx, row), created: true };
    });
  }

  public reverse(input: ReverseCreditGrantInput): Promise<CreditGrantResult> {
    return this.client.runTenantTx(input.tenantId, 'reverse credit grant', async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:grant-reversal:${input.reference}`}, 0))`,
      );
      const [referenceOwner] = await tx
        .select({ grantId: schema.creditGrantReversals.grantId })
        .from(schema.creditGrantReversals)
        .where(
          and(
            eq(schema.creditGrantReversals.tenantId, input.tenantId),
            eq(schema.creditGrantReversals.reference, input.reference),
          ),
        )
        .limit(1);
      if (referenceOwner && referenceOwner.grantId !== input.grantId) {
        throw new CreditGrantConflictError('Reversal reference belongs to another grant');
      }
      const [row] = await tx
        .select()
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.tenantId, input.tenantId),
            eq(schema.creditGrants.id, input.grantId),
          ),
        )
        .for('update')
        .limit(1);
      if (!row) throw new CreditGrantNotFoundError(input.grantId);
      const [reversal] = await tx
        .select()
        .from(schema.creditGrantReversals)
        .where(
          and(
            eq(schema.creditGrantReversals.tenantId, input.tenantId),
            eq(schema.creditGrantReversals.grantId, input.grantId),
          ),
        )
        .limit(1);
      if (reversal) {
        if (reversal.reference !== input.reference) {
          throw new CreditGrantConflictError('Grant already reversed with another reference');
        }
        return { grant: await this.toGrant(tx, row), created: false };
      }
      const balance = await this.balanceInTx(tx, input.tenantId, row.accountId);
      if (balance.remainingMinor < row.amountMinor) {
        throw new CreditGrantConflictError('Grant capacity has already been consumed');
      }
      const [account] = await tx
        .select({ currency: schema.accounts.currency })
        .from(schema.accounts)
        .where(
          and(eq(schema.accounts.tenantId, input.tenantId), eq(schema.accounts.id, row.accountId)),
        )
        .limit(1);
      if (!account) throw new AccountNotFoundError(row.accountId);
      const posted = await this.transactions.createInTx(
        tx,
        {
          tenantId: input.tenantId,
          ledgerId: row.ledgerId,
          reference: `credit-grant-reversal:${row.id}`,
          currency: account.currency,
          relatedTransactionId: row.transactionId,
          relationType: 'REVERSAL',
          entries: [
            {
              accountId: row.accountId,
              direction: EntryDirection.DEBIT,
              amountMinor: row.amountMinor,
              currency: account.currency,
            },
            {
              accountId: row.fundingAccountId,
              direction: EntryDirection.CREDIT,
              amountMinor: row.amountMinor,
              currency: account.currency,
            },
          ],
        },
        true,
      );
      await tx.insert(schema.creditGrantReversals).values({
        tenantId: input.tenantId,
        grantId: row.id,
        reference: input.reference,
        transactionId: posted.transactionId,
      });
      return { grant: await this.toGrant(tx, row), created: true };
    });
  }

  public findById(tenantId: string, grantId: string): Promise<CreditGrant | null> {
    return this.client.runTenantTx(tenantId, 'read credit grant', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.creditGrants)
        .where(and(eq(schema.creditGrants.tenantId, tenantId), eq(schema.creditGrants.id, grantId)))
        .limit(1);
      return row ? this.toGrant(tx, row) : null;
    });
  }

  public getBalance(tenantId: string, accountId: string): Promise<CreditBalance> {
    return this.client.runTenantTx(tenantId, 'read credit balance', (tx) =>
      this.balanceInTx(tx, tenantId, accountId),
    );
  }

  private async balanceInTx(tx: Tx, tenantId: string, accountId: string): Promise<CreditBalance> {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, accountId)))
      .for('update')
      .limit(1);
    if (!account) throw new AccountNotFoundError(accountId);
    if (!account.assetId || account.side !== 'CREDIT' || account.overdraftPolicy !== 'DISALLOW') {
      throw new CreditGrantConflictError(
        'Credit account requires a registered asset, CREDIT side and DISALLOW overdraft',
      );
    }
    if (account.inflightDebitMinor !== 0n || account.inflightCreditMinor !== 0n) {
      throw new CreditGrantConflictError('Credit account cannot have unallocated holds');
    }
    const rows = await tx
      .select()
      .from(schema.creditGrants)
      .where(
        and(
          eq(schema.creditGrants.tenantId, tenantId),
          eq(schema.creditGrants.accountId, accountId),
        ),
      );
    const buckets = new Map<string, CreditBalance['buckets'][number]>();
    let total = 0n;
    for (const row of rows) {
      if (row.assetId !== account.assetId || row.ledgerId !== account.ledgerId) {
        throw new CreditGrantConflictError('Grant account asset or ledger mismatch');
      }
      const [reversal] = await tx
        .select()
        .from(schema.creditGrantReversals)
        .where(
          and(
            eq(schema.creditGrantReversals.tenantId, tenantId),
            eq(schema.creditGrantReversals.grantId, row.id),
          ),
        )
        .limit(1);
      await this.assertLedgerEntry(tx, row, row.transactionId, 'CREDIT');
      if (reversal) await this.assertLedgerEntry(tx, row, reversal.transactionId, 'DEBIT');
      const bucket = buckets.get(row.origin) ?? {
        origin: row.origin,
        grantedMinor: 0n,
        allocatedMinor: 0n,
        consumedMinor: 0n,
        expiredMinor: 0n,
        reversedMinor: 0n,
        remainingMinor: 0n,
      };
      bucket.grantedMinor += row.amountMinor;
      if (reversal) bucket.reversedMinor += row.amountMinor;
      bucket.remainingMinor = creditGrantRemaining(bucket);
      buckets.set(row.origin, bucket);
      total += reversal ? 0n : row.amountMinor;
    }
    const [ledger] = await tx
      .select({
        posted: sql<string>`coalesce(sum(case when ${schema.entries.direction} = 'CREDIT' then ${schema.entries.amountMinor} else -${schema.entries.amountMinor} end), 0)::text`,
      })
      .from(schema.entries)
      .where(and(eq(schema.entries.tenantId, tenantId), eq(schema.entries.accountId, accountId)));
    if (total !== account.balanceMinor || total !== BigInt(ledger?.posted ?? '0')) {
      throw new CreditGrantConflictError(
        'Credit bucket totals do not reconcile with ledger balance',
      );
    }
    return {
      accountId,
      assetId: account.assetId,
      ledgerBalanceMinor: account.balanceMinor,
      remainingMinor: total,
      buckets: [...buckets.values()].sort((a, b) => a.origin.localeCompare(b.origin)),
    };
  }

  private async assertLedgerEntry(
    tx: Tx,
    row: GrantRow,
    transactionId: string,
    direction: 'CREDIT' | 'DEBIT',
  ): Promise<void> {
    const entries = await tx
      .select()
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.tenantId, row.tenantId),
          eq(schema.entries.transactionId, transactionId),
        ),
      );
    const wallet = entries.find((entry) => entry.accountId === row.accountId);
    const funding = entries.find((entry) => entry.accountId === row.fundingAccountId);
    if (
      entries.length !== 2 ||
      !wallet ||
      !funding ||
      wallet.direction !== direction ||
      funding.direction === direction ||
      wallet.amountMinor !== row.amountMinor ||
      funding.amountMinor !== row.amountMinor ||
      wallet.assetId !== row.assetId ||
      funding.assetId !== row.assetId
    ) {
      throw new CreditGrantConflictError('Grant ledger posting does not match immutable grant');
    }
  }

  private async toGrant(tx: Tx, row: GrantRow): Promise<CreditGrant> {
    const [reversal] = await tx
      .select({ transactionId: schema.creditGrantReversals.transactionId })
      .from(schema.creditGrantReversals)
      .where(
        and(
          eq(schema.creditGrantReversals.tenantId, row.tenantId),
          eq(schema.creditGrantReversals.grantId, row.id),
        ),
      )
      .limit(1);
    return {
      id: row.id,
      tenantId: row.tenantId,
      ledgerId: row.ledgerId,
      accountId: row.accountId,
      fundingAccountId: row.fundingAccountId,
      assetId: row.assetId,
      reference: row.reference,
      externalReference: row.externalReference,
      origin: row.origin,
      amountMinor: row.amountMinor,
      policy: {
        refundable: row.refundable,
        transferable: row.transferable,
        consumptionPriority: row.consumptionPriority,
        eligibility: row.eligibility,
      },
      transactionId: row.transactionId,
      createdAt: row.createdAt,
      reversedByTransactionId: reversal?.transactionId ?? null,
    };
  }

  private samePayload(row: GrantRow, input: CreateCreditGrantInput): boolean {
    return (
      row.ledgerId === input.ledgerId &&
      row.accountId === input.accountId &&
      row.fundingAccountId === input.fundingAccountId &&
      row.assetId === input.assetId &&
      row.origin === input.origin &&
      row.amountMinor === input.amountMinor &&
      row.externalReference === (input.externalReference ?? null) &&
      row.refundable === input.policy.refundable &&
      row.transferable === input.policy.transferable &&
      row.consumptionPriority === input.policy.consumptionPriority &&
      row.eligibility === input.policy.eligibility
    );
  }
}
