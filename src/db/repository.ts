import {
  DomainError,
  InvariantViolationError,
  LedgerNotFoundError,
  RepositoryError,
} from '@core/errors';
import type {
  AccountListItem,
  ApiKeyListItem,
  ApiKeyRepository,
  CreateLedgerInput,
  EntryListItem,
  Ledger,
  LedgerReadRepository,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
  PostTransactionInput,
  PostTransactionResult,
  StoredApiKey,
  TransactionListItem,
  TrialBalance,
  TrialBalanceAccount,
  TrialBalanceQuery,
} from '@core/types';
import {
  toAccountListItem,
  toApiKeyListItem,
  toEntryListItem,
  toLedger,
  toTransactionListItem,
} from '@db/mappers';
import * as schema from '@db/schema';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
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

interface RepositoryLogger {
  info(object: Record<string, unknown>, message: string): void;
}

interface CursorValue {
  createdAt: Date;
  id: string;
}

const parseCursor = (cursor: string | undefined): CursorValue | null => {
  if (!cursor) {
    return null;
  }

  let decoded: unknown;

  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    decoded = JSON.parse(text);
  } catch {
    throw new InvariantViolationError('Invalid cursor');
  }

  if (!isObjectRecord(decoded)) {
    throw new InvariantViolationError('Invalid cursor');
  }

  const createdAtRaw = decoded.created_at;
  const idRaw = decoded.id;

  if (typeof createdAtRaw !== 'string' || typeof idRaw !== 'string') {
    throw new InvariantViolationError('Invalid cursor');
  }

  const createdAt = new Date(createdAtRaw);

  if (Number.isNaN(createdAt.getTime())) {
    throw new InvariantViolationError('Invalid cursor');
  }

  return { createdAt, id: idRaw };
};

const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(
    JSON.stringify({
      created_at: createdAt.toISOString(),
      id,
    }),
    'utf8',
  ).toString('base64url');

const assertBalancedEntries = (entries: PostTransactionInput['entries']): void => {
  if (entries.length < 2) {
    throw new InvariantViolationError('transaction must have at least 2 entries');
  }

  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const entry of entries) {
    if (entry.direction === 'DEBIT') {
      debitTotal += entry.amountMinor;
    } else {
      creditTotal += entry.amountMinor;
    }
  }

  if (debitTotal !== creditTotal) {
    throw new InvariantViolationError('total debits must equal total credits');
  }
};
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

export class DrizzleLedgerRepository
  implements LedgerRepository, LedgerReadRepository, ApiKeyRepository
{
  private readonly db: PostgresJsDatabase<typeof schema>;
  private logger?: RepositoryLogger;

  public constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  public setLogger(logger: RepositoryLogger): void {
    this.logger = logger;
  }

  public async countApiKeys(): Promise<number> {
    try {
      const [row] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.apiKeys)
        .limit(1);
      return row?.count ?? 0;
    } catch (error) {
      this.handleDatabaseError(error, 'count api keys');
    }
  }

  public async createTenant(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    try {
      const [created] = await this.db
        .insert(schema.tenants)
        .values({ name: input.name })
        .returning();
      return {
        id: created.id,
        name: created.name,
        createdAt: created.createdAt,
      };
    } catch (error) {
      this.handleDatabaseError(error, 'create tenant');
    }
  }

  public async findActiveApiKeyByHash(keyHash: string): Promise<StoredApiKey | null> {
    try {
      const [row] = await this.db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.keyHash, keyHash), sql`${schema.apiKeys.revokedAt} is null`))
        .limit(1);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        tenantId: row.tenantId,
        role: row.role === 'ADMIN' ? 'ADMIN' : 'SERVICE',
        keyHash: row.keyHash,
        revokedAt: row.revokedAt,
      };
    } catch (error) {
      this.handleDatabaseError(error, 'find api key by hash');
    }
  }

  public async createApiKey(input: {
    tenantId: string;
    name: string;
    role: 'ADMIN' | 'SERVICE';
    keyHash: string;
  }): Promise<ApiKeyListItem> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [created] = await tx
          .insert(schema.apiKeys)
          .values({
            tenantId: input.tenantId,
            name: input.name,
            role: input.role,
            keyHash: input.keyHash,
          })
          .returning();

        return toApiKeyListItem(created);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'create api key');
    }
  }

  public async listApiKeys(tenantId: string): Promise<ApiKeyListItem[]> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.tenantId, tenantId))
          .orderBy(asc(schema.apiKeys.createdAt), asc(schema.apiKeys.id));

        return rows.map(toApiKeyListItem);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list api keys');
    }
  }

  public async revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const [row] = await tx
          .update(schema.apiKeys)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(schema.apiKeys.id, apiKeyId),
              eq(schema.apiKeys.tenantId, tenantId),
              sql`${schema.apiKeys.revokedAt} is null`,
            ),
          )
          .returning({ id: schema.apiKeys.id });

        return Boolean(row);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'revoke api key');
    }
  }

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [created] = await tx
          .insert(schema.ledgers)
          .values({
            tenantId: input.tenantId,
            name: input.name,
          })
          .returning();

        return toLedger(created);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'create ledger');
    }
  }

  public async findLedgerByIdForTenant(tenantId: string, id: string): Promise<Ledger | null> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const [ledger] = await tx
          .select()
          .from(schema.ledgers)
          .where(and(eq(schema.ledgers.tenantId, tenantId), eq(schema.ledgers.id, id)))
          .limit(1);

        if (!ledger) {
          return null;
        }

        return toLedger(ledger);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find ledger by id for tenant');
    }
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.ledgers)
          .where(eq(schema.ledgers.tenantId, tenantId))
          .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));

        return rows.map((row) => toLedger(row));
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find ledgers by tenant');
    }
  }

  public async postTransaction(input: PostTransactionInput): Promise<PostTransactionResult> {
    try {
      assertBalancedEntries(input.entries);

      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);

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

          this.logger?.info(
            {
              transactionId: existingTransaction.id,
              tenantId: input.tenantId,
              ledgerId: input.ledgerId,
              reference: input.reference,
              created: false,
            },
            'Posting accepted as idempotent retry',
          );

          return { transactionId: existingTransaction.id, created: false };
        }

        await tx.insert(schema.entries).values(
          input.entries.map((entry) => ({
            tenantId: input.tenantId,
            transactionId: insertedTransaction.id,
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

      if (result.created) {
        this.logger?.info(
          {
            transactionId: result.transactionId,
            tenantId: input.tenantId,
            ledgerId: input.ledgerId,
            reference: input.reference,
            created: true,
          },
          'Posting committed',
        );
      }

      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'post transaction');
    }
  }

  public async listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountListItem>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const cursor = parseCursor(query.cursor);
        const cursorPredicate = cursor
          ? or(
              gt(schema.accounts.createdAt, cursor.createdAt),
              and(
                eq(schema.accounts.createdAt, cursor.createdAt),
                gt(schema.accounts.id, cursor.id),
              ),
            )
          : sql`true`;

        const rows = await tx
          .select()
          .from(schema.accounts)
          .where(and(eq(schema.accounts.tenantId, query.tenantId), cursorPredicate))
          .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id))
          .limit(query.limit + 1);

        const hasNext = rows.length > query.limit;
        const pageRows = hasNext ? rows.slice(0, query.limit) : rows;
        const last = pageRows.at(-1);

        return {
          data: pageRows.map(toAccountListItem),
          nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list accounts');
    }
  }

  public async listTransactions(
    query: PaginationQuery,
  ): Promise<PaginatedResult<TransactionListItem>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const cursor = parseCursor(query.cursor);
        const cursorPredicate = cursor
          ? or(
              gt(schema.transactions.createdAt, cursor.createdAt),
              and(
                eq(schema.transactions.createdAt, cursor.createdAt),
                gt(schema.transactions.id, cursor.id),
              ),
            )
          : sql`true`;

        const rows = await tx
          .select()
          .from(schema.transactions)
          .where(and(eq(schema.transactions.tenantId, query.tenantId), cursorPredicate))
          .orderBy(asc(schema.transactions.createdAt), asc(schema.transactions.id))
          .limit(query.limit + 1);

        const hasNext = rows.length > query.limit;
        const pageRows = hasNext ? rows.slice(0, query.limit) : rows;
        const last = pageRows.at(-1);

        return {
          data: pageRows.map(toTransactionListItem),
          nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list transactions');
    }
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryListItem>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const cursor = parseCursor(query.cursor);
        const cursorPredicate = cursor
          ? or(
              gt(schema.entries.createdAt, cursor.createdAt),
              and(eq(schema.entries.createdAt, cursor.createdAt), gt(schema.entries.id, cursor.id)),
            )
          : sql`true`;

        const rows = await tx
          .select()
          .from(schema.entries)
          .where(and(eq(schema.entries.tenantId, query.tenantId), cursorPredicate))
          .orderBy(asc(schema.entries.createdAt), asc(schema.entries.id))
          .limit(query.limit + 1);

        const hasNext = rows.length > query.limit;
        const pageRows = hasNext ? rows.slice(0, query.limit) : rows;
        const last = pageRows.at(-1);

        return {
          data: pageRows.map((row) => toEntryListItem(row)),
          nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list entries');
    }
  }

  public async getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const [ledger] = await tx
          .select({ id: schema.ledgers.id })
          .from(schema.ledgers)
          .where(
            and(eq(schema.ledgers.id, query.ledgerId), eq(schema.ledgers.tenantId, query.tenantId)),
          )
          .limit(1);

        if (!ledger) {
          throw new LedgerNotFoundError(query.ledgerId);
        }

        const accountRows = await tx
          .select()
          .from(schema.accounts)
          .where(
            and(
              eq(schema.accounts.ledgerId, query.ledgerId),
              eq(schema.accounts.tenantId, query.tenantId),
            ),
          )
          .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id));

        let totalDebitsMinor = 0n;
        let totalCreditsMinor = 0n;

        const accounts: TrialBalanceAccount[] = accountRows.map((row) => {
          const isDebit = row.balanceMinor <= 0n;
          const absoluteBalance = row.balanceMinor < 0n ? -row.balanceMinor : row.balanceMinor;

          if (isDebit) {
            totalDebitsMinor += absoluteBalance;
          } else {
            totalCreditsMinor += absoluteBalance;
          }

          return {
            accountId: row.id,
            code: row.id,
            name: row.name,
            normalBalance: isDebit ? 'DEBIT' : 'CREDIT',
            balanceMinor: absoluteBalance,
          };
        });

        if (totalDebitsMinor !== totalCreditsMinor) {
          throw new RepositoryError('trial balance totals mismatch');
        }

        return {
          ledgerId: query.ledgerId,
          accounts,
          totalDebitsMinor,
          totalCreditsMinor,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'get trial balance');
    }
  }

  private async withTenantContext<T>(
    tenantId: string,
    operation: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return operation(tx);
    });
  }

  private handleDatabaseError(error: unknown, operation: string): never {
    if (error instanceof DomainError) {
      throw error;
    }

    const databaseCode = extractDatabaseCode(error);

    if (databaseCode && CONSTRAINT_VIOLATION_CODES.has(databaseCode)) {
      throw new InvariantViolationError(`Unable to ${operation}: data constraints violated`, {
        cause: error,
      });
    }

    throw new RepositoryError(`Unable to ${operation}`, { cause: error });
  }
}
