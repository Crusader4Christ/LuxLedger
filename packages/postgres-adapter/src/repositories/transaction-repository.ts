import {
  aggregateAccountEntries,
  type EntryEntity,
  isDomainError,
  parseAccountSide,
  type TransactionEntity,
  type TransactionMetadata,
} from '@luxledger/core';
import {
  assertAvailableBalance,
  type BulkCreateTransactionInput,
  type BulkCreateTransactionResult,
  BulkTransactionError,
  type CorrectTransactionInput,
  type CorrectTransactionResult,
  type CreateTransactionInput,
  type CreateTransactionResult,
  InvariantViolationError,
  type PaginatedResult,
  type PaginationQuery,
  RepositoryError,
  type ReverseTransactionInput,
  type ReverseTransactionResult,
  type TransactionApplicationRepository,
  type TransactionPaginationQuery,
} from '@luxledger/core/application';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DbClient } from '../client';
import { toEntryEntity } from '../mappers/entry-mapper';
import { toTransactionEntity } from '../mappers/transaction-mapper';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';
import { toStoredTransactionMetadata } from '../transaction-metadata';
import { lockGrantEnabledAccountsForMutation } from './account-mutation-lock';
import { insertBalanceSnapshot } from './balance-snapshot';
import { loadEntriesByTransactionIds } from './entry-loader';
import { validatePosting, validatePostingEntries } from './posting-validation';

type TransactionRow = typeof schema.transactions.$inferSelect;
type EntryRow = typeof schema.entries.$inferSelect;

export class DrizzleTransactionRepository implements TransactionApplicationRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    return this.client.runTenantTx(input.tenantId, 'create transaction', async (tx) =>
      this.createInTx(tx, input),
    );
  }

  public postCreditGrantInTx(
    tx: PostgresJsDatabase<typeof schema>,
    input: CreateTransactionInput,
  ): Promise<CreateTransactionResult> {
    return this.createInTx(tx, input);
  }

  public postCreditGrantReversalInTx(
    tx: PostgresJsDatabase<typeof schema>,
    input: CreateTransactionInput & { relatedTransactionId: string; relationType: 'REVERSAL' },
  ): Promise<CreateTransactionResult> {
    return this.createOrResolvePostedTransaction(tx, {
      ...input,
      description: input.description ?? null,
      effectiveAt: input.effectiveAt ?? undefined,
      compareDescriptionOnRetry: true,
      payloadMismatchMessage: 'Unable to create transaction: reference payload mismatch',
      skipGrantLineage: true,
    });
  }

  public postCreditGrantExpirationInTx(
    tx: PostgresJsDatabase<typeof schema>,
    input: CreateTransactionInput,
  ): Promise<CreateTransactionResult> {
    return this.createOrResolvePostedTransaction(tx, {
      ...input,
      description: input.description ?? null,
      effectiveAt: input.effectiveAt ?? undefined,
      compareDescriptionOnRetry: true,
      payloadMismatchMessage: 'Unable to expire credit grant: reference payload mismatch',
      skipGrantLineage: true,
    });
  }

  private createInTx(
    tx: PostgresJsDatabase<typeof schema>,
    input: CreateTransactionInput & {
      relatedTransactionId?: string;
      relationType?: 'REVERSAL' | 'CORRECTION';
    },
  ): Promise<CreateTransactionResult> {
    return this.createOrResolvePostedTransaction(tx, {
      ...input,
      description: input.description ?? null,
      effectiveAt: input.effectiveAt ?? undefined,
      compareDescriptionOnRetry: true,
      payloadMismatchMessage: 'Unable to create transaction: reference payload mismatch',
    });
  }

  public async createBulk(input: BulkCreateTransactionInput): Promise<BulkCreateTransactionResult> {
    return this.client.runTenantTx(input.tenantId, 'bulk create transactions', async (tx) => {
      const results = [];
      for (const [itemIndex, transaction] of input.transactions.entries()) {
        try {
          const result = await this.createOrResolvePostedTransaction(tx, {
            ...transaction,
            description: transaction.description ?? null,
            effectiveAt: transaction.effectiveAt ?? undefined,
            compareDescriptionOnRetry: true,
            payloadMismatchMessage:
              'Unable to bulk create transactions: reference payload mismatch',
          });
          results.push({
            reference: transaction.reference,
            transactionId: result.transactionId,
            created: result.created,
          });
        } catch (error) {
          throw this.toBulkTransactionError(error, itemIndex, transaction.reference);
        }
      }
      return {
        createdCount: results.filter((transaction) => transaction.created).length,
        idempotentCount: results.filter((transaction) => !transaction.created).length,
        transactions: results,
      };
    });
  }

  public async reverse(input: ReverseTransactionInput): Promise<ReverseTransactionResult> {
    return this.client.runTenantTx(input.tenantId, 'reverse transaction', async (tx) => {
      const original = await this.lockTransaction(tx, input.tenantId, input.transactionId);
      if (!original) {
        throw new InvariantViolationError('Unable to reverse transaction: original not found');
      }
      if (original.relatedTransactionId) {
        throw new InvariantViolationError(
          'Unable to reverse transaction: cannot reverse a reversal',
        );
      }

      const originalEntries = await this.loadEntriesByTransactionIds(tx, input.tenantId, [
        input.transactionId,
      ]);
      const entries = originalEntries.get(input.transactionId) ?? [];
      if (entries.length < 2) {
        throw new InvariantViolationError(
          'Unable to reverse transaction: original entries are missing',
        );
      }

      const reversal = await this.createOrResolveReversal(tx, {
        tenantId: input.tenantId,
        originalTransactionId: original.id,
        ledgerId: original.ledgerId,
        reference: input.reference,
        currency: original.currency,
        description: input.description ?? null,
        entries: entries.map((entry) => ({
          accountId: entry.accountId.value,
          signedAmountMinor: -entry.money.amountMinor,
          currency: entry.money.currency,
        })),
      });
      await this.expireRestoredGrantsInTx(tx, input.tenantId, reversal.transactionId);
      return reversal;
    });
  }

  public async correct(input: CorrectTransactionInput): Promise<CorrectTransactionResult> {
    return this.client.runTenantTx(input.tenantId, 'correct transaction', async (tx) => {
      const original = await this.lockTransaction(tx, input.tenantId, input.transactionId);
      if (!original) {
        throw new InvariantViolationError('Unable to correct transaction: original not found');
      }
      if (original.relatedTransactionId) {
        throw new InvariantViolationError(
          'Unable to correct transaction: cannot correct a reversal',
        );
      }
      validatePostingEntries(input.entries, original.currency);
      const originalEntries = await this.loadEntriesByTransactionIds(tx, input.tenantId, [
        input.transactionId,
      ]);
      const reversalEntries = (originalEntries.get(input.transactionId) ?? []).map((entry) => ({
        accountId: entry.accountId.value,
        signedAmountMinor: -entry.money.amountMinor,
        currency: entry.money.currency,
      }));
      const persistedOriginalEntries = originalEntries.get(input.transactionId) ?? [];
      if (persistedOriginalEntries.length < 2) {
        throw new InvariantViolationError(
          'Unable to correct transaction: original entries are missing',
        );
      }
      if (this.areEquivalentTransactionEntries(persistedOriginalEntries, input.entries)) {
        throw new InvariantViolationError(
          'Unable to correct transaction: corrected entries must differ',
        );
      }
      const reversal = await this.createOrResolveReversal(tx, {
        tenantId: input.tenantId,
        originalTransactionId: input.transactionId,
        ledgerId: original.ledgerId,
        currency: original.currency,
        reference: input.reversalReference,
        description: input.description ?? null,
        entries: reversalEntries,
      });
      await this.expireRestoredGrantsInTx(tx, input.tenantId, reversal.transactionId);

      const corrected = await this.createOrResolvePostedTransaction(tx, {
        tenantId: input.tenantId,
        ledgerId: original.ledgerId,
        reference: input.correctedReference,
        currency: original.currency,
        description: input.description ?? null,
        relatedTransactionId: input.transactionId,
        relationType: 'CORRECTION',
        entries: input.entries,
        compareDescriptionOnRetry: true,
        payloadMismatchMessage: 'Unable to correct transaction: reference payload mismatch',
      });
      return {
        reversalTransactionId: reversal.transactionId,
        correctedTransactionId: corrected.transactionId,
        created: reversal.created || corrected.created,
      };
    });
  }

  public async list(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    return this.client.runTenantTx(query.tenantId, 'list transactions', async (tx) => {
      const predicates = [eq(schema.transactions.tenantId, query.tenantId)];
      if (query.ledgerId !== undefined) {
        predicates.push(eq(schema.transactions.ledgerId, query.ledgerId));
      }

      const page = await paginateByCursor<TransactionRow>({
        query,
        order: [
          {
            column: schema.transactions.createdAt,
            key: 'created_at',
            type: 'date',
            direction: 'asc',
            getValue: (row: TransactionRow) => row.createdAt,
          },
          {
            column: schema.transactions.id,
            key: 'id',
            type: 'string',
            direction: 'asc',
            getValue: (row: TransactionRow) => row.id,
          },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select()
            .from(schema.transactions)
            .where(and(...predicates, cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });
      const entriesByTransactionId = await this.loadEntriesByTransactionIds(
        tx,
        query.tenantId,
        page.rows.map((row) => row.id),
      );

      return {
        data: page.rows.map((row) =>
          toTransactionEntity(row, entriesByTransactionId.get(row.id) ?? []),
        ),
        nextCursor: page.nextCursor,
      };
    });
  }

  public async findById(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null> {
    return this.client.runTenantTx(tenantId, 'find transaction by id for tenant', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.tenantId, tenantId),
            eq(schema.transactions.id, transactionId),
          ),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      const entriesByTransactionId = await this.loadEntriesByTransactionIds(tx, tenantId, [row.id]);

      return toTransactionEntity(row, entriesByTransactionId.get(row.id) ?? []);
    });
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    return this.client.runTenantTx(query.tenantId, 'list entries', async (tx) => {
      const page = await paginateByCursor<EntryRow>({
        query,
        order: [
          {
            column: schema.entries.createdAt,
            key: 'created_at',
            type: 'date',
            direction: 'asc',
            getValue: (row: EntryRow) => row.createdAt,
          },
          {
            column: schema.entries.id,
            key: 'id',
            type: 'string',
            direction: 'asc',
            getValue: (row: EntryRow) => row.id,
          },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select()
            .from(schema.entries)
            .where(and(eq(schema.entries.tenantId, query.tenantId), cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });

      return {
        data: page.rows.map(toEntryEntity),
        nextCursor: page.nextCursor,
      };
    });
  }

  private async loadEntriesByTransactionIds(
    tx: PostgresJsDatabase<typeof schema>,
    tenantId: string,
    transactionIds: string[],
  ): Promise<Map<string, EntryEntity[]>> {
    return loadEntriesByTransactionIds(tx, tenantId, transactionIds);
  }

  private resolveEffectiveAt(value: Date | null | undefined): Date {
    return value ?? new Date();
  }

  private async createOrResolvePostedTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      ledgerId: string;
      reference: string;
      currency: string;
      description: string | null;
      effectiveAt?: Date;
      metadata?: TransactionMetadata;
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      skipGrantLineage?: boolean;
      entries: Array<{
        accountId: string;
        signedAmountMinor: bigint;
        currency: string;
      }>;
      compareDescriptionOnRetry?: boolean;
      payloadMismatchMessage: string;
    },
  ): Promise<{ transactionId: string; created: boolean }> {
    const effectiveAt = this.resolveEffectiveAt(input.effectiveAt);
    const metadata = toStoredTransactionMetadata(input.metadata);
    await validatePosting(tx, input);
    await lockGrantEnabledAccountsForMutation(
      tx,
      input.tenantId,
      input.entries.map((entry) => entry.accountId),
    );
    const [asset] = await tx
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(eq(schema.assets.tenantId, input.tenantId), eq(schema.assets.code, input.currency)),
      )
      .limit(1);
    if (!asset) throw new InvariantViolationError('Asset must be created before transaction');

    const [inserted] = await tx
      .insert(schema.transactions)
      .values({
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        assetId: asset.id,
        description: input.description,
        metadata,
        effectiveAt,
        relatedTransactionId: input.relatedTransactionId ?? null,
        relationType: input.relationType ?? null,
      })
      .onConflictDoNothing({
        target: [schema.transactions.tenantId, schema.transactions.reference],
      })
      .returning({ id: schema.transactions.id });

    if (inserted) {
      await this.applyPostedTransaction(
        tx,
        { ...input, assetId: asset.id },
        inserted.id,
        effectiveAt,
      );
      return { transactionId: inserted.id, created: true };
    }

    const [existing] = await tx
      .select({
        id: schema.transactions.id,
        ledgerId: schema.transactions.ledgerId,
        currency: schema.transactions.currency,
        description: schema.transactions.description,
        metadataMatches:
          metadata === null
            ? isNull(schema.transactions.metadata)
            : eq(schema.transactions.metadata, metadata),
        effectiveAt: schema.transactions.effectiveAt,
        relatedTransactionId: schema.transactions.relatedTransactionId,
        relationType: schema.transactions.relationType,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.tenantId, input.tenantId),
          eq(schema.transactions.reference, input.reference),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new RepositoryError('Unable to resolve idempotent transaction');
    }

    if (
      existing.ledgerId !== input.ledgerId ||
      existing.currency !== input.currency ||
      (input.compareDescriptionOnRetry === true &&
        (existing.description ?? null) !== input.description) ||
      !existing.metadataMatches ||
      (input.effectiveAt !== undefined &&
        existing.effectiveAt.getTime() !== effectiveAt.getTime()) ||
      (existing.relatedTransactionId ?? null) !== (input.relatedTransactionId ?? null) ||
      (existing.relationType ?? null) !== (input.relationType ?? null)
    ) {
      throw new InvariantViolationError(input.payloadMismatchMessage);
    }
    const existingEntriesByTransactionId = await this.loadEntriesByTransactionIds(
      tx,
      input.tenantId,
      [existing.id],
    );
    const existingEntries = existingEntriesByTransactionId.get(existing.id) ?? [];
    if (!this.areEquivalentTransactionEntries(existingEntries, input.entries)) {
      throw new InvariantViolationError(input.payloadMismatchMessage);
    }
    return { transactionId: existing.id, created: false };
  }

  private async createOrResolveReversal(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      originalTransactionId: string;
      ledgerId: string;
      currency: string;
      reference: string;
      description: string | null;
      effectiveAt?: Date;
      entries: Array<{
        accountId: string;
        signedAmountMinor: bigint;
        currency: string;
      }>;
    },
  ): Promise<{ transactionId: string; created: boolean }> {
    const candidates = await tx
      .select({
        id: schema.transactions.id,
        reference: schema.transactions.reference,
        relatedTransactionId: schema.transactions.relatedTransactionId,
        relationType: schema.transactions.relationType,
        description: schema.transactions.description,
        metadata: schema.transactions.metadata,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.tenantId, input.tenantId),
          or(
            eq(schema.transactions.reference, input.reference),
            and(
              eq(schema.transactions.relatedTransactionId, input.originalTransactionId),
              eq(schema.transactions.relationType, 'REVERSAL'),
            ),
          ),
        ),
      );
    const existingReversal = candidates.find(
      (candidate) =>
        candidate.relatedTransactionId === input.originalTransactionId &&
        candidate.relationType === 'REVERSAL',
    );
    const existingByReference = candidates.find(
      (candidate) => candidate.reference === input.reference,
    );

    if (
      existingReversal?.reference === input.reference &&
      (existingReversal.description ?? null) === input.description &&
      existingReversal.metadata === null
    ) {
      return { transactionId: existingReversal.id, created: false };
    }
    if (existingReversal || existingByReference) {
      throw new InvariantViolationError(
        'Unable to reverse transaction: reference payload mismatch',
      );
    }

    const transactionId = await this.createPostedTransaction(tx, {
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      reference: input.reference,
      currency: input.currency,
      description: input.description,
      effectiveAt: input.effectiveAt,
      relatedTransactionId: input.originalTransactionId,
      relationType: 'REVERSAL',
      entries: input.entries,
    });
    return { transactionId, created: true };
  }

  private async createPostedTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      ledgerId: string;
      reference: string;
      currency: string;
      description: string | null;
      effectiveAt?: Date;
      metadata?: TransactionMetadata;
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      skipGrantLineage?: boolean;
      entries: Array<{
        accountId: string;
        signedAmountMinor: bigint;
        currency: string;
      }>;
    },
  ): Promise<string> {
    const effectiveAt = this.resolveEffectiveAt(input.effectiveAt);
    const metadata = toStoredTransactionMetadata(input.metadata);
    await validatePosting(tx, input);
    await lockGrantEnabledAccountsForMutation(
      tx,
      input.tenantId,
      input.entries.map((entry) => entry.accountId),
    );
    const [asset] = await tx
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(eq(schema.assets.tenantId, input.tenantId), eq(schema.assets.code, input.currency)),
      )
      .limit(1);
    if (!asset) throw new InvariantViolationError('Asset must be created before transaction');
    const [insertedTransaction] = await tx
      .insert(schema.transactions)
      .values({
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        assetId: asset.id,
        description: input.description,
        metadata,
        effectiveAt,
        relatedTransactionId: input.relatedTransactionId ?? null,
        relationType: input.relationType ?? null,
      })
      .returning({ id: schema.transactions.id });

    await this.applyPostedTransaction(
      tx,
      { ...input, assetId: asset.id },
      insertedTransaction.id,
      effectiveAt,
    );
    return insertedTransaction.id;
  }

  private async applyPostedTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      ledgerId: string;
      currency: string;
      assetId: string;
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      skipGrantLineage?: boolean;
      entries: Array<{
        accountId: string;
        signedAmountMinor: bigint;
        currency: string;
      }>;
    },
    transactionId: string,
    effectiveAt: Date,
  ): Promise<void> {
    const insertedEntries = await tx
      .insert(schema.entries)
      .values(
        input.entries.map((entry) => ({
          tenantId: input.tenantId,
          transactionId,
          accountId: entry.accountId,
          signedAmountMinor: entry.signedAmountMinor,
          currency: entry.currency,
          assetId: input.assetId,
        })),
      )
      .returning({
        id: schema.entries.id,
        accountId: schema.entries.accountId,
        signedAmountMinor: schema.entries.signedAmountMinor,
      });
    if (!input.skipGrantLineage) {
      await this.recordGrantLineage(tx, { ...input, effectiveAt }, insertedEntries);
    }
    const entriesForBalanceUpdate = aggregateAccountEntries(input.entries);
    for (const entry of entriesForBalanceUpdate) {
      const delta = entry.signedAmountMinor;
      const [updatedAccount] = await tx
        .update(schema.accounts)
        .set({
          balanceMinor: sql`${schema.accounts.balanceMinor} + ${delta}`,
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
          'Unable to create transaction: account ledger/currency mismatch',
        );
      }
      assertAvailableBalance({ ...updatedAccount, side: parseAccountSide(updatedAccount.side) });
      const [previousSnapshot] = await tx
        .select({ postedMinor: schema.balanceSnapshots.postedMinor })
        .from(schema.balanceSnapshots)
        .where(
          and(
            eq(schema.balanceSnapshots.tenantId, input.tenantId),
            eq(schema.balanceSnapshots.accountId, entry.accountId),
            lte(schema.balanceSnapshots.effectiveAt, effectiveAt),
          ),
        )
        .orderBy(desc(schema.balanceSnapshots.effectiveAt), desc(schema.balanceSnapshots.id))
        .limit(1);
      await insertBalanceSnapshot(tx, {
        tenantId: input.tenantId,
        eventType: 'TX_APPLIED',
        sourceId: transactionId,
        accountId: updatedAccount.id,
        ledgerId: updatedAccount.ledgerId,
        postedMinor: (previousSnapshot?.postedMinor ?? 0n) + delta,
        reservedDeltaMinor: updatedAccount.reservedDeltaMinor,
        effectiveAt,
      });
      await tx
        .update(schema.balanceSnapshots)
        .set({
          postedMinor: sql`${schema.balanceSnapshots.postedMinor} + ${delta}`,
        })
        .where(
          and(
            eq(schema.balanceSnapshots.tenantId, input.tenantId),
            eq(schema.balanceSnapshots.accountId, updatedAccount.id),
            gt(schema.balanceSnapshots.effectiveAt, effectiveAt),
          ),
        );
    }
  }

  private async recordGrantLineage(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      ledgerId: string;
      assetId: string;
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      effectiveAt: Date;
    },
    insertedEntries: Array<{
      id: string;
      accountId: string;
      signedAmountMinor: bigint;
    }>,
  ): Promise<void> {
    const copiedOriginalEntryIds = new Set<string>();
    const orderedEntries = [...insertedEntries].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const entriesByAccount = new Map<string, typeof orderedEntries>();
    for (const entry of orderedEntries) {
      const accountEntries = entriesByAccount.get(entry.accountId) ?? [];
      accountEntries.push(entry);
      entriesByAccount.set(entry.accountId, accountEntries);
    }
    const lineageRows: Array<typeof schema.creditGrantEntries.$inferInsert> = [];
    const orderedAccountEntries = [...entriesByAccount.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );

    for (const [accountId, accountEntries] of orderedAccountEntries) {
      const grants = await tx
        .select({
          id: schema.creditGrants.id,
          expiresAt: schema.creditGrants.expiresAt,
          eligible: sql<boolean>`${schema.creditGrants.expiresAt} is null or (${schema.creditGrants.expiresAt} > ${input.effectiveAt.toISOString()}::timestamptz and ${schema.creditGrants.expiresAt} > transaction_timestamp())`,
        })
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.tenantId, input.tenantId),
            eq(schema.creditGrants.ledgerId, input.ledgerId),
            eq(schema.creditGrants.accountId, accountId),
          ),
        )
        .orderBy(
          sql`${schema.creditGrants.expiresAt} asc nulls last`,
          schema.creditGrants.createdAt,
          schema.creditGrants.id,
        )
        .for('update');
      if (grants.length === 0) continue;

      if (input.relationType === 'REVERSAL' && input.relatedTransactionId) {
        const originalLinks = await tx
          .select({
            entryId: schema.creditGrantEntries.entryId,
            grantId: schema.creditGrantEntries.grantId,
            kind: schema.creditGrantEntries.kind,
            amountMinor: schema.creditGrantEntries.amountMinor,
          })
          .from(schema.creditGrantEntries)
          .innerJoin(schema.entries, eq(schema.creditGrantEntries.entryId, schema.entries.id))
          .where(
            and(
              eq(schema.creditGrantEntries.tenantId, input.tenantId),
              eq(schema.creditGrantEntries.accountId, accountId),
              eq(schema.entries.transactionId, input.relatedTransactionId),
            ),
          )
          .orderBy(schema.entries.createdAt, schema.entries.id, schema.creditGrantEntries.grantId);
        const candidatesByKind = new Map<
          'ISSUANCE' | 'CONSUMPTION',
          Map<string, typeof originalLinks>
        >();
        for (const link of originalLinks) {
          if (link.kind !== 'ISSUANCE' && link.kind !== 'CONSUMPTION') continue;
          const candidates = candidatesByKind.get(link.kind) ?? new Map();
          const links = candidates.get(link.entryId) ?? [];
          links.push(link);
          candidates.set(link.entryId, links);
          candidatesByKind.set(link.kind, candidates);
        }

        for (const entry of accountEntries) {
          const originalKind = entry.signedAmountMinor < 0n ? 'CONSUMPTION' : 'ISSUANCE';
          const newKind: 'COMPENSATION' | 'REVERSAL' =
            entry.signedAmountMinor < 0n ? 'COMPENSATION' : 'REVERSAL';
          const magnitudeMinor =
            entry.signedAmountMinor < 0n ? -entry.signedAmountMinor : entry.signedAmountMinor;
          const match = [...(candidatesByKind.get(originalKind)?.entries() ?? [])].find(
            ([entryId, links]) =>
              !copiedOriginalEntryIds.has(entryId) &&
              links.reduce((sum, link) => sum + link.amountMinor, 0n) === magnitudeMinor,
          );
          if (!match) {
            throw new InvariantViolationError(
              'Unable to reverse transaction: grant lineage does not match original entry',
            );
          }
          const [originalEntryId, copied] = match;
          copiedOriginalEntryIds.add(originalEntryId);
          lineageRows.push(
            ...copied.map((link) => ({
              tenantId: input.tenantId,
              ledgerId: input.ledgerId,
              accountId,
              grantId: link.grantId,
              entryId: entry.id,
              kind: newKind,
              amountMinor: link.amountMinor,
            })),
          );
        }
        continue;
      }

      const debitEntries = accountEntries.filter((entry) => entry.signedAmountMinor > 0n);
      if (debitEntries.length === 0) continue;
      const capacities = await tx
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
      const remainingByGrant = new Map(grants.map((grant) => [grant.id, 0n]));
      for (const capacity of capacities) {
        remainingByGrant.set(capacity.grantId, capacity.remainingMinor);
      }
      for (const entry of debitEntries) {
        let required = entry.signedAmountMinor;
        for (const grant of grants) {
          if (!grant.eligible) continue;
          const available = remainingByGrant.get(grant.id) ?? 0n;
          if (available <= 0n) continue;
          const amountMinor = available < required ? available : required;
          lineageRows.push({
            tenantId: input.tenantId,
            ledgerId: input.ledgerId,
            accountId,
            grantId: grant.id,
            entryId: entry.id,
            kind: 'CONSUMPTION',
            amountMinor,
          });
          remainingByGrant.set(grant.id, available - amountMinor);
          required -= amountMinor;
          if (required === 0n) break;
        }
        if (required !== 0n) {
          throw new InvariantViolationError(
            'Unable to create transaction: insufficient credit grant capacity',
          );
        }
      }
    }

    if (lineageRows.length > 0) {
      await tx.insert(schema.creditGrantEntries).values(lineageRows);
    }
  }

  private async expireRestoredGrantsInTx(
    tx: PostgresJsDatabase<typeof schema>,
    tenantId: string,
    compensationTransactionId: string,
  ): Promise<void> {
    const restored = await tx
      .selectDistinct({ grantId: schema.creditGrantEntries.grantId })
      .from(schema.creditGrantEntries)
      .innerJoin(schema.entries, eq(schema.creditGrantEntries.entryId, schema.entries.id))
      .innerJoin(schema.creditGrants, eq(schema.creditGrantEntries.grantId, schema.creditGrants.id))
      .where(
        and(
          eq(schema.creditGrantEntries.tenantId, tenantId),
          eq(schema.creditGrantEntries.kind, 'COMPENSATION'),
          eq(schema.entries.transactionId, compensationTransactionId),
          sql`${schema.creditGrants.expiresAt} <= transaction_timestamp()`,
        ),
      );
    if (restored.length === 0) return;

    const grants = await tx
      .select({
        id: schema.creditGrants.id,
        tenantId: schema.creditGrants.tenantId,
        ledgerId: schema.creditGrants.ledgerId,
        accountId: schema.creditGrants.accountId,
        fundingAccountId: schema.creditGrants.fundingAccountId,
        expiresAt: schema.creditGrants.expiresAt,
      })
      .from(schema.creditGrants)
      .where(
        and(
          eq(schema.creditGrants.tenantId, tenantId),
          inArray(
            schema.creditGrants.id,
            restored.map((row) => row.grantId),
          ),
        ),
      )
      .orderBy(
        schema.creditGrants.accountId,
        schema.creditGrants.expiresAt,
        schema.creditGrants.createdAt,
        schema.creditGrants.id,
      )
      .for('update');

    for (const grant of grants) {
      if (!grant.expiresAt) continue;
      const [capacity] = await tx
        .select({
          remainingMinor: schema.creditGrantCapacityVersions.remainingMinor,
          expiredMinor: schema.creditGrantCapacityVersions.expiredMinor,
        })
        .from(schema.creditGrantCapacityVersions)
        .where(
          and(
            eq(schema.creditGrantCapacityVersions.tenantId, tenantId),
            eq(schema.creditGrantCapacityVersions.grantId, grant.id),
          ),
        )
        .orderBy(desc(schema.creditGrantCapacityVersions.version))
        .limit(1);
      const remainingMinor = capacity?.remainingMinor ?? 0n;
      if (remainingMinor <= 0n) continue;
      const cumulativeExpiredMinor = (capacity?.expiredMinor ?? 0n) + remainingMinor;
      const [account] = await tx
        .select({ currency: schema.accounts.currency })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, grant.accountId)))
        .limit(1);
      if (!account)
        throw new InvariantViolationError('Unable to expire credit grant: account missing');
      const posted = await this.postCreditGrantExpirationInTx(tx, {
        tenantId,
        ledgerId: grant.ledgerId,
        reference: `credit-grant-expiration:${grant.id}:${cumulativeExpiredMinor}`,
        currency: account.currency,
        effectiveAt: grant.expiresAt,
        entries: [
          {
            accountId: grant.accountId,
            signedAmountMinor: remainingMinor,
            currency: account.currency,
          },
          {
            accountId: grant.fundingAccountId,
            signedAmountMinor: -remainingMinor,
            currency: account.currency,
          },
        ],
      });
      if (!posted.created) continue;
      const [walletEntry] = await tx
        .select({ id: schema.entries.id, signedAmountMinor: schema.entries.signedAmountMinor })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.tenantId, tenantId),
            eq(schema.entries.transactionId, posted.transactionId),
            eq(schema.entries.accountId, grant.accountId),
          ),
        )
        .limit(1);
      if (!walletEntry) {
        throw new InvariantViolationError('Unable to expire credit grant: wallet entry missing');
      }
      await tx.insert(schema.creditGrantEntries).values({
        tenantId,
        ledgerId: grant.ledgerId,
        accountId: grant.accountId,
        grantId: grant.id,
        entryId: walletEntry.id,
        kind: 'EXPIRATION',
        amountMinor:
          walletEntry.signedAmountMinor < 0n
            ? -walletEntry.signedAmountMinor
            : walletEntry.signedAmountMinor,
      });
    }
  }

  private areEquivalentTransactionEntries(
    existingEntries: EntryEntity[],
    inputEntries: Array<{
      accountId: string;
      signedAmountMinor: bigint;
      currency: string;
    }>,
  ): boolean {
    if (existingEntries.length !== inputEntries.length) {
      return false;
    }
    const normalize = (entries: string[]) => entries.sort();
    const existing = normalize(
      existingEntries.map(
        (entry) =>
          `${entry.accountId.value}:${entry.money.amountMinor.toString()}:${entry.money.currency}`,
      ),
    );
    const input = normalize(
      inputEntries.map(
        (entry) => `${entry.accountId}:${entry.signedAmountMinor.toString()}:${entry.currency}`,
      ),
    );
    return existing.every((value, index) => value === input[index]);
  }

  private async lockTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionRow | null> {
    const [row] = await tx
      .select()
      .from(schema.transactions)
      .where(
        and(eq(schema.transactions.tenantId, tenantId), eq(schema.transactions.id, transactionId)),
      )
      .for('update')
      .limit(1);

    return row ?? null;
  }

  private toBulkTransactionError(
    error: unknown,
    itemIndex: number,
    reference: string,
  ): BulkTransactionError {
    if (isDomainError(error)) {
      return new BulkTransactionError({
        itemIndex,
        reference,
        category:
          error.httpStatus >= 500
            ? 'PERSISTENCE'
            : error.httpStatus === 409
              ? 'CONFLICT'
              : 'VALIDATION',
        message: error.message,
        httpStatus: error.httpStatus,
        cause: error,
      });
    }

    return new BulkTransactionError({
      itemIndex,
      reference,
      category: 'PERSISTENCE',
      message: 'Internal server error',
      httpStatus: 500,
      cause: error,
    });
  }
}
