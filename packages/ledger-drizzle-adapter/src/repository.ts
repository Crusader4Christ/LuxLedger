import { randomUUID } from 'node:crypto';
import {
  AccountEntity,
  AccountSide,
  ApiKeyRole,
  ApiKeyEntity,
  CreateTransactionUseCase,
  EntryDirection,
  EntryEntity,
  AccountId as LedgerAccountId,
  DomainError as LedgerDomainError,
  LedgerEntity,
  LedgerId as LedgerLedgerId,
  TransactionId as LedgerTransactionId,
  Money,
  TransactionEntity,
} from '@lux/ledger';
import {
  type ApiKeyRepository,
  type CreateLedgerInput,
  type CreateTransactionInput,
  type CreateTransactionResult,
  InvariantViolationError,
  LedgerNotFoundError,
  type LedgerRepository,
  type PaginatedResult,
  type PaginationQuery,
  RepositoryError,
  type TrialBalance,
  type TrialBalanceAccount,
  type TrialBalanceQuery,
} from '@lux/ledger/application';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Logger } from 'pino';
import type { CursorValue, DatabaseErrorLike } from './repository-types';
import * as schema from './schema';

const CONSTRAINT_VIOLATION_CODES = new Set([
  '22001', // string_data_right_truncation
  '22007', // invalid_datetime_format
  '22P02', // invalid_text_representation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
]);

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

const parseApiKeyRole = (role: string): ApiKeyRole => {
  if ((Object.values(ApiKeyRole) as ApiKeyRole[]).includes(role as ApiKeyRole)) {
    return role as ApiKeyRole;
  }

  throw new RepositoryError('Unable to parse api key role');
};

const parseEntryDirection = (direction: string): EntryDirection => {
  if ((Object.values(EntryDirection) as EntryDirection[]).includes(direction as EntryDirection)) {
    return direction as EntryDirection;
  }

  throw new RepositoryError('Unable to parse entry direction');
};

const parseAccountSide = (side: string): AccountSide => {
  if ((Object.values(AccountSide) as AccountSide[]).includes(side as AccountSide)) {
    return side as AccountSide;
  }

  throw new RepositoryError('Unable to parse account side');
};

export class DrizzleLedgerRepository implements LedgerRepository, ApiKeyRepository {
  private readonly db: PostgresJsDatabase<typeof schema>;
  private readonly logger: Logger;

  public constructor(db: PostgresJsDatabase<typeof schema>, logger: Logger) {
    this.db = db;
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

  public async findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    try {
      const [row] = await this.db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.keyHash, keyHash), sql`${schema.apiKeys.revokedAt} is null`))
        .limit(1);

      if (!row) {
        return null;
      }

      return new ApiKeyEntity({
        id: row.id,
        tenantId: row.tenantId,
        name: row.name,
        role: parseApiKeyRole(row.role),
        keyHash: row.keyHash,
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find api key by hash');
    }
  }

  public async createApiKey(input: {
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
  }): Promise<ApiKeyEntity> {
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

        return new ApiKeyEntity({
          id: created.id,
          tenantId: created.tenantId,
          name: created.name,
          role: parseApiKeyRole(created.role),
          keyHash: created.keyHash,
          createdAt: created.createdAt,
          revokedAt: created.revokedAt,
        });
      });
    } catch (error) {
      this.handleDatabaseError(error, 'create api key');
    }
  }

  public async listApiKeys(tenantId: string): Promise<ApiKeyEntity[]> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.tenantId, tenantId))
          .orderBy(asc(schema.apiKeys.createdAt), asc(schema.apiKeys.id));

        return rows.map(
          (row) =>
            new ApiKeyEntity({
              id: row.id,
              tenantId: row.tenantId,
              name: row.name,
              role: parseApiKeyRole(row.role),
              keyHash: row.keyHash,
              createdAt: row.createdAt,
              revokedAt: row.revokedAt,
            }),
        );
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

  public async createLedger(input: CreateLedgerInput): Promise<LedgerEntity> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [created] = await tx
          .insert(schema.ledgers)
          .values({
            tenantId: input.tenantId,
            name: input.name,
          })
          .returning();

        return new LedgerEntity({
          id: created.id,
          tenantId: created.tenantId,
          name: created.name,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        });
      });
    } catch (error) {
      this.handleDatabaseError(error, 'create ledger');
    }
  }

  public async findLedgerByIdForTenant(tenantId: string, id: string): Promise<LedgerEntity | null> {
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

        return new LedgerEntity({
          id: ledger.id,
          tenantId: ledger.tenantId,
          name: ledger.name,
          createdAt: ledger.createdAt,
          updatedAt: ledger.updatedAt,
        });
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find ledger by id for tenant');
    }
  }

  public async findLedgersByTenant(tenantId: string): Promise<LedgerEntity[]> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.ledgers)
          .where(eq(schema.ledgers.tenantId, tenantId))
          .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));

        return rows.map(
          (row) =>
            new LedgerEntity({
              id: row.id,
              tenantId: row.tenantId,
              name: row.name,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            }),
        );
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find ledgers by tenant');
    }
  }

  public async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
        await this.validateCreateTransactionInvariants(tx, input);

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

          this.logger.info(
            {
              transactionId: existingTransaction.id,
              tenantId: input.tenantId,
              ledgerId: input.ledgerId,
              reference: input.reference,
              created: false,
            },
            'Transaction accepted as idempotent retry',
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
            .returning({ id: schema.accounts.id });

          if (!updatedAccount) {
            throw new InvariantViolationError(
              'Unable to create transaction: account ledger/currency mismatch',
            );
          }
        }

        return {
          transactionId: insertedTransaction.id,
          created: true,
        };
      });

      if (result.created) {
        this.logger.info(
          {
            transactionId: result.transactionId,
            tenantId: input.tenantId,
            ledgerId: input.ledgerId,
            reference: input.reference,
            created: true,
          },
          'Transaction committed',
        );
      }

      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'create transaction');
    }
  }

  private async validateCreateTransactionInvariants(
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
          id: new LedgerAccountId(row.id),
          ledgerId: new LedgerLedgerId(row.ledgerId),
          currency: row.currency,
        }));
      },
    });

    try {
      await useCase.execute({
        tenantId: input.tenantId,
        id: randomUUID(),
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        entries: input.entries,
      });
    } catch (error) {
      if (error instanceof LedgerDomainError) {
        throw new InvariantViolationError(error.message, { cause: error });
      }

      throw error;
    }
  }

  public async listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountEntity>> {
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
          data: pageRows.map(
            (row) =>
              new AccountEntity({
                id: row.id,
                tenantId: row.tenantId,
                ledgerId: row.ledgerId,
                name: row.name,
                side: parseAccountSide(row.side),
                currency: row.currency,
                balanceMinor: row.balanceMinor,
                createdAt: row.createdAt,
              }),
          ),
          nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list accounts');
    }
  }

  public async listTransactions(
    query: PaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
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
        const transactionIds = pageRows.map((row) => row.id);

        const entryRows =
          transactionIds.length === 0
            ? []
            : await tx
                .select()
                .from(schema.entries)
                .where(
                  and(
                    eq(schema.entries.tenantId, query.tenantId),
                    inArray(schema.entries.transactionId, transactionIds),
                  ),
                )
                .orderBy(asc(schema.entries.createdAt), asc(schema.entries.id));

        const entriesByTransactionId = new Map<string, EntryEntity[]>();

        for (const row of entryRows) {
          const entry = new EntryEntity({
            id: row.id,
            transactionId: row.transactionId,
            accountId: new LedgerAccountId(row.accountId),
            direction: parseEntryDirection(row.direction),
            money: Money.of(row.amountMinor, row.currency),
            createdAt: row.createdAt,
          });

          const existingEntries = entriesByTransactionId.get(row.transactionId) ?? [];
          existingEntries.push(entry);
          entriesByTransactionId.set(row.transactionId, existingEntries);
        }

        return {
          data: pageRows.map(
            (row) =>
              new TransactionEntity({
                id: new LedgerTransactionId(row.id),
                tenantId: row.tenantId,
                ledgerId: new LedgerLedgerId(row.ledgerId),
                reference: row.reference,
                currency: row.currency,
                createdAt: row.createdAt,
                entries: entriesByTransactionId.get(row.id) ?? [],
              }),
          ),
          nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list transactions');
    }
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
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
          data: pageRows.map(
            (row) =>
              new EntryEntity({
                id: row.id,
                transactionId: row.transactionId,
                accountId: new LedgerAccountId(row.accountId),
                direction: parseEntryDirection(row.direction),
                money: Money.of(row.amountMinor, row.currency),
                createdAt: row.createdAt,
              }),
          ),
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
          const side = parseAccountSide(row.side);
          const isDebit = row.balanceMinor < 0n;
          const isContra =
            row.balanceMinor !== 0n &&
            (side === AccountSide.DEBIT ? !isDebit : isDebit);

          if (isDebit) {
            totalDebitsMinor += -row.balanceMinor;
          } else if (row.balanceMinor > 0n) {
            totalCreditsMinor += row.balanceMinor;
          }

          return {
            accountId: row.id,
            code: row.id,
            name: row.name,
            normalBalance: side,
            balanceMinor: isDebit ? -row.balanceMinor : row.balanceMinor,
            isContra,
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
    if (error instanceof LedgerDomainError) {
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
