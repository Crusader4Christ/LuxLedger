import { InvariantViolationError, RepositoryError } from '@core/errors';
import type { CreateLedgerInput, Ledger, LedgerRepository } from '@core/types';
import { toLedger } from '@db/mappers';
import * as schema from '@db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const CONSTRAINT_VIOLATION_CODES = new Set([
  '22001', // string_data_right_truncation
  '22007', // invalid_datetime_format
  '22P02', // invalid_text_representation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
]);

interface DatabaseErrorLike {
  code?: unknown;
  cause?: unknown;
}

export interface PostingEntryInput {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
  currency: string;
}

export interface PostTransactionInput {
  tenantId: string;
  ledgerId: string;
  reference: string;
  currency: string;
  entries: PostingEntryInput[];
}

export interface PostTransactionResult {
  transactionId: string;
  created: boolean;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractDatabaseCode = (error: unknown): string | null => {
  if (!isObjectRecord(error)) {
    return null;
  }

  const dbError = error as DatabaseErrorLike;

  if (typeof dbError.code === 'string') {
    return dbError.code;
  }

  if ('cause' in error) {
    return extractDatabaseCode(dbError.cause);
  }

  return null;
};

export class DrizzleLedgerRepository implements LedgerRepository {
  private readonly db: PostgresJsDatabase<typeof schema>;

  public constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    try {
      const [created] = await this.db
        .insert(schema.ledgers)
        .values({
          tenantId: input.tenantId,
          name: input.name,
        })
        .returning();

      return toLedger(created);
    } catch (error) {
      this.handleDatabaseError(error, 'create ledger');
    }
  }

  public async findLedgerById(id: string): Promise<Ledger | null> {
    try {
      const [ledger] = await this.db
        .select()
        .from(schema.ledgers)
        .where(eq(schema.ledgers.id, id))
        .limit(1);

      if (!ledger) {
        return null;
      }

      return toLedger(ledger);
    } catch (error) {
      this.handleDatabaseError(error, 'find ledger by id');
    }
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    try {
      const rows = await this.db
        .select()
        .from(schema.ledgers)
        .where(eq(schema.ledgers.tenantId, tenantId))
        .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));

      return rows.map((row) => toLedger(row));
    } catch (error) {
      this.handleDatabaseError(error, 'find ledgers by tenant');
    }
  }

  public async postTransaction(input: PostTransactionInput): Promise<PostTransactionResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const [insertedTransaction] = await tx
          .insert(schema.transactions)
          .values({
            tenantId: input.tenantId,
            ledgerId: input.ledgerId,
            reference: input.reference,
            currency: input.currency,
          })
          .onConflictDoNothing({
            target: [schema.transactions.tenantId, schema.transactions.reference],
          })
          .returning({ id: schema.transactions.id });

        if (!insertedTransaction) {
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

          if (!existingTransaction) {
            throw new RepositoryError('Unable to resolve idempotent transaction');
          }

          return { transactionId: existingTransaction.id, created: false };
        }

        await tx.insert(schema.entries).values(
          input.entries.map((entry) => ({
            transactionId: insertedTransaction.id,
            accountId: entry.accountId,
            direction: entry.direction,
            amountMinor: entry.amountMinor,
            currency: entry.currency,
          })),
        );

        for (const entry of input.entries) {
          const delta = entry.direction === 'DEBIT' ? -entry.amountMinor : entry.amountMinor;

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
            .returning({ id: schema.accounts.id });

          if (!updatedAccount) {
            throw new InvariantViolationError(
              'Unable to post transaction: account ledger/currency mismatch',
            );
          }
        }

        return {
          transactionId: insertedTransaction.id,
          created: true,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'post transaction');
    }
  }

  private handleDatabaseError(error: unknown, operation: string): never {
    const databaseCode = extractDatabaseCode(error);

    if (databaseCode && CONSTRAINT_VIOLATION_CODES.has(databaseCode)) {
      throw new InvariantViolationError(`Unable to ${operation}: data constraints violated`, {
        cause: error,
      });
    }

    throw new RepositoryError(`Unable to ${operation}`, { cause: error });
  }
}
