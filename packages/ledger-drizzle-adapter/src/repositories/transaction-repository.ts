import {
  EntryDirection,
  type EntryEntity,
  DomainError as LedgerDomainError,
  type TransactionEntity,
} from '@lux/ledger';
import {
  type BulkCreateTransactionInput,
  type BulkCreateTransactionResult,
  BulkTransactionError,
  type CorrectTransactionInput,
  type CorrectTransactionResult,
  type CreateTransactionInput,
  type CreateTransactionResult,
  InvariantViolationError,
  OverdraftPolicyViolationError,
  type PaginatedResult,
  type PaginationQuery,
  RepositoryError,
  type ReverseTransactionInput,
  type ReverseTransactionResult,
  type TransactionApplicationRepository,
  type TransactionPaginationQuery,
} from '@lux/ledger/application';
import { and, desc, eq, gt, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DbClient } from '../client';
import { toEntryEntity } from '../mappers/entry-mapper';
import { toTransactionEntity } from '../mappers/transaction-mapper';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';
import { insertBalanceSnapshot } from './balance-snapshot';
import { loadEntriesByTransactionIds } from './entry-loader';
import { validatePosting, validatePostingEntries } from './posting-validation';

type TransactionRow = typeof schema.transactions.$inferSelect;
type EntryRow = typeof schema.entries.$inferSelect;

export class DrizzleTransactionRepository implements TransactionApplicationRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    return this.client.runTenantTx(input.tenantId, 'create transaction', async (tx) =>
      this.createOrResolvePostedTransaction(tx, {
        ...input,
        description: input.description ?? null,
        effectiveAt: input.effectiveAt ?? undefined,
        payloadMismatchMessage: 'Unable to create transaction: reference payload mismatch',
      }),
    );
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

      return this.createOrResolveReversal(tx, {
        tenantId: input.tenantId,
        originalTransactionId: original.id,
        ledgerId: original.ledgerId,
        reference: input.reference,
        currency: original.currency,
        description: input.description ?? null,
        entries: entries.map((entry) => ({
          accountId: entry.accountId.value,
          direction:
            entry.direction === EntryDirection.DEBIT ? EntryDirection.CREDIT : EntryDirection.DEBIT,
          amountMinor: entry.money.amountMinor,
          currency: entry.money.currency,
        })),
      });
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
        direction:
          entry.direction === EntryDirection.DEBIT ? EntryDirection.CREDIT : EntryDirection.DEBIT,
        amountMinor: entry.money.amountMinor,
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
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      entries: Array<{
        accountId: string;
        direction: EntryDirection;
        amountMinor: bigint;
        currency: string;
      }>;
      compareDescriptionOnRetry?: boolean;
      payloadMismatchMessage: string;
    },
  ): Promise<{ transactionId: string; created: boolean }> {
    const effectiveAt = this.resolveEffectiveAt(input.effectiveAt);
    await validatePosting(tx, input);

    const [inserted] = await tx
      .insert(schema.transactions)
      .values({
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        description: input.description,
        effectiveAt,
        relatedTransactionId: input.relatedTransactionId ?? null,
        relationType: input.relationType ?? null,
      })
      .onConflictDoNothing({
        target: [schema.transactions.tenantId, schema.transactions.reference],
      })
      .returning({ id: schema.transactions.id });

    if (inserted) {
      await this.applyPostedTransaction(tx, input, inserted.id, effectiveAt);
      return { transactionId: inserted.id, created: true };
    }

    const [existing] = await tx
      .select({
        id: schema.transactions.id,
        ledgerId: schema.transactions.ledgerId,
        currency: schema.transactions.currency,
        description: schema.transactions.description,
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
        direction: EntryDirection;
        amountMinor: bigint;
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
      (existingReversal.description ?? null) === input.description
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
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      entries: Array<{
        accountId: string;
        direction: EntryDirection;
        amountMinor: bigint;
        currency: string;
      }>;
    },
  ): Promise<string> {
    const effectiveAt = this.resolveEffectiveAt(input.effectiveAt);
    await validatePosting(tx, input);
    const [insertedTransaction] = await tx
      .insert(schema.transactions)
      .values({
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        description: input.description,
        effectiveAt,
        relatedTransactionId: input.relatedTransactionId ?? null,
        relationType: input.relationType ?? null,
      })
      .returning({ id: schema.transactions.id });

    await this.applyPostedTransaction(tx, input, insertedTransaction.id, effectiveAt);
    return insertedTransaction.id;
  }

  private async applyPostedTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      ledgerId: string;
      currency: string;
      entries: Array<{
        accountId: string;
        direction: EntryDirection;
        amountMinor: bigint;
        currency: string;
      }>;
    },
    transactionId: string,
    effectiveAt: Date,
  ): Promise<void> {
    await tx.insert(schema.entries).values(
      input.entries.map((entry) => ({
        tenantId: input.tenantId,
        transactionId,
        accountId: entry.accountId,
        direction: entry.direction,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
      })),
    );
    const entriesForBalanceUpdate = [...input.entries].sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );
    for (const entry of entriesForBalanceUpdate) {
      const delta =
        entry.direction === EntryDirection.DEBIT ? -entry.amountMinor : entry.amountMinor;
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
          overdraftPolicy: schema.accounts.overdraftPolicy,
          balanceMinor: schema.accounts.balanceMinor,
          inflightDebitMinor: schema.accounts.inflightDebitMinor,
          inflightCreditMinor: schema.accounts.inflightCreditMinor,
        });
      if (!updatedAccount) {
        throw new InvariantViolationError(
          'Unable to create transaction: account ledger/currency mismatch',
        );
      }
      if (updatedAccount.overdraftPolicy === 'DISALLOW' && updatedAccount.balanceMinor < 0n) {
        throw new OverdraftPolicyViolationError(updatedAccount.id, updatedAccount.balanceMinor);
      }
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
        inflightDebitMinor: updatedAccount.inflightDebitMinor,
        inflightCreditMinor: updatedAccount.inflightCreditMinor,
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

  private areEquivalentTransactionEntries(
    existingEntries: EntryEntity[],
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
    const normalize = (entries: string[]) => entries.sort();
    const existing = normalize(
      existingEntries.map(
        (entry) =>
          `${entry.accountId.value}:${entry.direction}:${entry.money.amountMinor.toString()}:${entry.money.currency}`,
      ),
    );
    const input = normalize(
      inputEntries.map(
        (entry) =>
          `${entry.accountId}:${entry.direction}:${entry.amountMinor.toString()}:${entry.currency}`,
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
    if (error instanceof LedgerDomainError) {
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
