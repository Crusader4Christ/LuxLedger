import {
  AccountEntity,
  AccountSide,
  ApiKeyEntity,
  ApiKeyRole,
  CreateTransactionUseCase,
  EntryDirection,
  EntryEntity,
  isUuidV7,
  AccountId as LedgerAccountId,
  DomainError as LedgerDomainError,
  LedgerEntity,
  LedgerId as LedgerLedgerId,
  TransactionId as LedgerTransactionId,
  Money,
  parseAccountSide,
  parseEntryDirection,
  parseOverdraftPolicy,
  type ReconRecord,
  type ReconMatchCriterion,
  type ReconResultStatus,
  type ReconRule,
  type ReconStrategy,
  reconcileOneToOne,
  TransactionEntity,
} from '@lux/ledger';
import {
  type AccountPaginationQuery,
  type ApiKeyRepository,
  type BalanceAtQuery,
  type BalanceHistoryQuery,
  type BalanceSnapshotEvent,
  type CommitHoldInput,
  type CommitHoldResult,
  type CorrectTransactionInput,
  type CorrectTransactionResult,
  type CreateAccountInput,
  type CreateHoldInput,
  type CreateHoldResult,
  type CreateLedgerInput,
  type CreateReconRuleInput,
  type CreateTransactionInput,
  type CreateTransactionResult,
  type HistoricalBalance,
  type IngestReconRecordsInput,
  InvariantViolationError,
  LedgerNotFoundError,
  type LedgerRepository,
  type LedgerTrialBalanceQuery,
  OverdraftPolicyViolationError,
  type PaginatedResult,
  type PaginationQuery,
  type ReconResult,
  type ReconRun,
  type ReconUpload,
  RepositoryError,
  type ReverseTransactionInput,
  type ReverseTransactionResult,
  type RunReconInput,
  type TransactionPaginationQuery,
  type TrialBalance,
  type TrialBalanceAccount,
  type VoidHoldInput,
  type VoidHoldResult,
} from '@lux/ledger/application';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import stringify from 'safe-stable-stringify';
import { paginateByCursor } from './paginate-by-cursor';
import type { DatabaseErrorLike } from './repository-types';
import * as schema from './schema';

export interface RepositoryLogger {
  info(context: Record<string, unknown>, message: string): void;
}

const CONSTRAINT_VIOLATION_CODES = new Set([
  '22001', // string_data_right_truncation
  '22007', // invalid_datetime_format
  '22P02', // invalid_text_representation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
]);

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

const generateUuidV7 = (): string => {
  const timestampHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randomHex = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    .toString(16)
    .padStart(20, '0')
    .slice(-20);
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-7${randomHex.slice(0, 3)}-8${randomHex.slice(3, 6)}-${randomHex.slice(6, 18)}`;
};

const serializeMatchingCriteria = (criteria: ReconMatchCriterion[]): ReconRuleRow['criteria'] =>
  criteria.map((criterion) => ({
    field: criterion.field,
    operator: criterion.operator,
    amountToleranceMinor: criterion.amountToleranceMinor?.toString(),
    dateToleranceSeconds: criterion.dateToleranceSeconds,
  }));

const parseMatchingCriteria = (criteria: ReconRuleRow['criteria']): ReconMatchCriterion[] =>
  criteria.map((criterion) => ({
    field: criterion.field as ReconMatchCriterion['field'],
    operator: criterion.operator as ReconMatchCriterion['operator'],
    amountToleranceMinor:
      criterion.amountToleranceMinor === undefined
        ? undefined
        : BigInt(criterion.amountToleranceMinor),
    dateToleranceSeconds: criterion.dateToleranceSeconds,
  }));

const toMatchingRule = (row: ReconRuleRow): ReconRule => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  description: row.description,
  criteria: parseMatchingCriteria(row.criteria),
  createdAt: row.createdAt,
});

const toReconRecord = (row: ReconRecordRow): ReconRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  uploadId: row.uploadId,
  externalId: row.externalId,
  source: row.source,
  amountMinor: row.amountMinor,
  currency: row.currency,
  reference: row.reference,
  description: row.description,
  occurredAt: row.occurredAt,
  raw: row.raw ?? null,
});

type AccountRow = typeof schema.accounts.$inferSelect;
type TransactionRow = typeof schema.transactions.$inferSelect;
type EntryRow = typeof schema.entries.$inferSelect;
type HoldRow = typeof schema.holds.$inferSelect;
type BalanceSnapshotEventType = typeof schema.balanceSnapshots.$inferSelect.eventType;
type ReconRecordRow = typeof schema.reconRecords.$inferSelect;
type ReconRuleRow = typeof schema.reconRules.$inferSelect;
type ReconRunRow = typeof schema.reconRuns.$inferSelect;
type ReconResultRow = typeof schema.reconResults.$inferSelect;

export class DrizzleLedgerRepository implements LedgerRepository, ApiKeyRepository {
  private readonly db: PostgresJsDatabase<typeof schema>;
  private readonly logger: RepositoryLogger;

  public constructor(db: PostgresJsDatabase<typeof schema>, logger: RepositoryLogger) {
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

  public async findApiKeyById(apiKeyId: string): Promise<ApiKeyEntity | null> {
    try {
      const [row] = await this.db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, apiKeyId))
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
      this.handleDatabaseError(error, 'find api key by id');
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

  public async createAccount(input: CreateAccountInput): Promise<AccountEntity> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [ledger] = await tx
          .select({ id: schema.ledgers.id })
          .from(schema.ledgers)
          .where(
            and(eq(schema.ledgers.id, input.ledgerId), eq(schema.ledgers.tenantId, input.tenantId)),
          )
          .limit(1);

        if (!ledger) {
          throw new LedgerNotFoundError(input.ledgerId);
        }

        const [created] = await tx
          .insert(schema.accounts)
          .values({
            tenantId: input.tenantId,
            ledgerId: input.ledgerId,
            name: input.name,
            side: input.side,
            overdraftPolicy: input.overdraftPolicy ?? 'ALLOW',
            currency: input.currency,
          })
          .returning();

        return new AccountEntity({
          id: created.id,
          tenantId: created.tenantId,
          ledgerId: created.ledgerId,
          name: created.name,
          side: parseAccountSide(created.side),
          overdraftPolicy: parseOverdraftPolicy(created.overdraftPolicy),
          currency: created.currency,
          balanceMinor: created.balanceMinor,
          createdAt: created.createdAt,
        });
      });
    } catch (error) {
      this.handleDatabaseError(error, 'create account');
    }
  }

  public async findAccountByIdForTenant(
    tenantId: string,
    accountId: string,
  ): Promise<AccountEntity | null> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.accounts)
          .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, accountId)))
          .limit(1);

        if (!row) {
          return null;
        }

        return new AccountEntity({
          id: row.id,
          tenantId: row.tenantId,
          ledgerId: row.ledgerId,
          name: row.name,
          side: parseAccountSide(row.side),
          overdraftPolicy: parseOverdraftPolicy(row.overdraftPolicy),
          currency: row.currency,
          balanceMinor: row.balanceMinor,
          createdAt: row.createdAt,
        });
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find account by id for tenant');
    }
  }

  public async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
        this.validateHoldEntriesInput(input.entries, input.currency);
        await this.validateCreateTransactionInvariants(tx, input);

        const [insertedTransaction] = await tx
          .insert(schema.transactions)
          .values({
            tenantId: input.tenantId,
            ledgerId: input.ledgerId,
            reference: input.reference,
            currency: input.currency,
            description: input.description ?? null,
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
          await this.insertBalanceSnapshot(tx, {
            tenantId: input.tenantId,
            eventType: 'TX_APPLIED',
            sourceId: insertedTransaction.id,
            accountId: updatedAccount.id,
            ledgerId: updatedAccount.ledgerId,
            postedMinor: updatedAccount.balanceMinor,
            inflightDebitMinor: updatedAccount.inflightDebitMinor,
            inflightCreditMinor: updatedAccount.inflightCreditMinor,
          });
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

  public async createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
        await this.validateCreateTransactionInvariants(tx, input);

        const amountMinor = this.resolveTotalDebit(input.entries);
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
          await this.insertBalanceSnapshot(tx, {
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

      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'create hold');
    }
  }

  public async reverseTransaction(
    input: ReverseTransactionInput,
  ): Promise<ReverseTransactionResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
        const original = await this.lockTransaction(tx, input.tenantId, input.transactionId);
        if (!original) {
          throw new InvariantViolationError('Unable to reverse transaction: original not found');
        }
        if (original.relatedTransactionId) {
          throw new InvariantViolationError(
            'Unable to reverse transaction: cannot reverse a reversal',
          );
        }

        const [byReference] = await tx
          .select({
            id: schema.transactions.id,
            relatedTransactionId: schema.transactions.relatedTransactionId,
            relationType: schema.transactions.relationType,
            description: schema.transactions.description,
          })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.tenantId, input.tenantId),
              eq(schema.transactions.reference, input.reference),
            ),
          )
          .limit(1);
        if (byReference) {
          if (
            byReference.relatedTransactionId !== input.transactionId ||
            byReference.relationType !== 'REVERSAL' ||
            (byReference.description ?? null) !== (input.description ?? null)
          ) {
            throw new InvariantViolationError(
              'Unable to reverse transaction: reference payload mismatch',
            );
          }
          return { transactionId: byReference.id, created: false };
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

        const created = await this.createPostedTransaction(tx, {
          tenantId: input.tenantId,
          ledgerId: original.ledgerId,
          reference: input.reference,
          currency: original.currency,
          description: input.description ?? null,
          relatedTransactionId: original.id,
          relationType: 'REVERSAL',
          entries: entries.map((entry) => ({
            accountId: entry.accountId.value,
            direction:
              entry.direction === EntryDirection.DEBIT
                ? EntryDirection.CREDIT
                : EntryDirection.DEBIT,
            amountMinor: entry.money.amountMinor,
            currency: entry.money.currency,
          })),
        });
        return { transactionId: created, created: true };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'reverse transaction');
    }
  }

  public async correctTransaction(
    input: CorrectTransactionInput,
  ): Promise<CorrectTransactionResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
        const original = await this.lockTransaction(tx, input.tenantId, input.transactionId);
        if (!original) {
          throw new InvariantViolationError('Unable to correct transaction: original not found');
        }
        if (original.relatedTransactionId) {
          throw new InvariantViolationError(
            'Unable to correct transaction: cannot correct a reversal',
          );
        }
        this.validateHoldEntriesInput(input.entries, original.currency);
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
          payloadMismatchMessage: 'Unable to correct transaction: reference payload mismatch',
        });
        return {
          reversalTransactionId: reversal.transactionId,
          correctedTransactionId: corrected.transactionId,
          created: reversal.created || corrected.created,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'correct transaction');
    }
  }

  public async commitHold(input: CommitHoldInput): Promise<CommitHoldResult> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
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
          throw new InvariantViolationError(
            'Unable to commit hold: amount exceeds remaining amount',
          );
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

        for (const entry of committedEntries.sort((a, b) =>
          a.accountId.localeCompare(b.accountId),
        )) {
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
          await this.insertBalanceSnapshot(tx, {
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
      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'commit hold');
    }
  }

  public async voidHold(input: VoidHoldInput): Promise<VoidHoldResult> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
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
          throw new InvariantViolationError(
            `Unable to void hold: invalid hold state ${hold.state}`,
          );
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
          await this.insertBalanceSnapshot(tx, {
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
      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'void hold');
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
        id: generateUuidV7(),
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        description: input.description ?? null,
        entries: input.entries,
      });
    } catch (error) {
      if (error instanceof LedgerDomainError) {
        throw new InvariantViolationError(error.message, { cause: error });
      }

      throw error;
    }
  }

  public async listAccounts(
    query: AccountPaginationQuery,
  ): Promise<PaginatedResult<AccountEntity>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const predicates = [eq(schema.accounts.tenantId, query.tenantId)];
        if (query.ledgerId !== undefined) {
          predicates.push(eq(schema.accounts.ledgerId, query.ledgerId));
        }

        const page = await paginateByCursor<AccountRow>({
          query,
          order: [
            {
              column: schema.accounts.createdAt,
              key: 'created_at',
              type: 'date',
              direction: 'asc',
              getValue: (row: AccountRow) => row.createdAt,
            },
            {
              column: schema.accounts.id,
              key: 'id',
              type: 'string',
              direction: 'asc',
              getValue: (row: AccountRow) => row.id,
            },
          ],
          selectRows: async ({ cursorPredicate, limit, orderBy }) =>
            tx
              .select()
              .from(schema.accounts)
              .where(and(...predicates, cursorPredicate))
              .orderBy(...orderBy)
              .limit(limit),
        });

        return {
          data: page.rows.map(
            (row) =>
              new AccountEntity({
                id: row.id,
                tenantId: row.tenantId,
                ledgerId: row.ledgerId,
                name: row.name,
                side: parseAccountSide(row.side),
                overdraftPolicy: parseOverdraftPolicy(row.overdraftPolicy),
                currency: row.currency,
                balanceMinor: row.balanceMinor,
                createdAt: row.createdAt,
              }),
          ),
          nextCursor: page.nextCursor,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list accounts');
    }
  }

  public async listTransactions(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
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
          data: page.rows.map(
            (row) =>
              new TransactionEntity({
                id: new LedgerTransactionId(row.id),
                tenantId: row.tenantId,
                ledgerId: new LedgerLedgerId(row.ledgerId),
                reference: row.reference,
                currency: row.currency,
                description: row.description,
                relatedTransactionId: row.relatedTransactionId,
                relationType: row.relationType,
                createdAt: row.createdAt,
                entries: entriesByTransactionId.get(row.id) ?? [],
              }),
          ),
          nextCursor: page.nextCursor,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list transactions');
    }
  }

  public async findTransactionByIdForTenant(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
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

        const entriesByTransactionId = await this.loadEntriesByTransactionIds(tx, tenantId, [
          row.id,
        ]);

        return new TransactionEntity({
          id: new LedgerTransactionId(row.id),
          tenantId: row.tenantId,
          ledgerId: new LedgerLedgerId(row.ledgerId),
          reference: row.reference,
          currency: row.currency,
          description: row.description,
          relatedTransactionId: row.relatedTransactionId,
          relationType: row.relationType,
          createdAt: row.createdAt,
          entries: entriesByTransactionId.get(row.id) ?? [],
        });
      });
    } catch (error) {
      this.handleDatabaseError(error, 'find transaction by id for tenant');
    }
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
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
          data: page.rows.map(
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
          nextCursor: page.nextCursor,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list entries');
    }
  }

  public async getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
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
            row.balanceMinor !== 0n && (side === AccountSide.DEBIT ? !isDebit : isDebit);

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

  public async getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.balanceSnapshots)
          .where(
            and(
              eq(schema.balanceSnapshots.tenantId, query.tenantId),
              eq(schema.balanceSnapshots.accountId, query.accountId),
              sql`${schema.balanceSnapshots.effectiveAt} <= ${query.at}`,
            ),
          )
          .orderBy(
            sql`${schema.balanceSnapshots.effectiveAt} desc`,
            sql`${schema.balanceSnapshots.id} desc`,
          )
          .limit(1);

        const postedMinor = row?.postedMinor ?? 0n;
        const inflightDebitMinor = row?.inflightDebitMinor ?? 0n;
        const inflightCreditMinor = row?.inflightCreditMinor ?? 0n;
        return {
          tenantId: query.tenantId,
          accountId: query.accountId,
          at: query.at,
          postedMinor,
          inflightDebitMinor,
          inflightCreditMinor,
          availableMinor: postedMinor - inflightDebitMinor + inflightCreditMinor,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'get historical balance');
    }
  }

  public async listBalanceHistory(
    query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
    try {
      return await this.withTenantContext(query.tenantId, async (tx) => {
        const cursor = this.decodeSnapshotCursor(query.cursor);
        const rows = await tx
          .select()
          .from(schema.balanceSnapshots)
          .where(
            and(
              eq(schema.balanceSnapshots.tenantId, query.tenantId),
              eq(schema.balanceSnapshots.accountId, query.accountId),
              sql`${schema.balanceSnapshots.effectiveAt} >= ${query.from}`,
              sql`${schema.balanceSnapshots.effectiveAt} <= ${query.to}`,
              cursor
                ? sql`(${schema.balanceSnapshots.effectiveAt}, ${schema.balanceSnapshots.id}) > (${cursor.effectiveAt}, ${cursor.id})`
                : sql`true`,
            ),
          )
          .orderBy(asc(schema.balanceSnapshots.effectiveAt), asc(schema.balanceSnapshots.id))
          .limit(query.limit + 1);

        const hasMore = rows.length > query.limit;
        const dataRows = hasMore ? rows.slice(0, query.limit) : rows;
        const data = dataRows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          ledgerId: row.ledgerId,
          accountId: row.accountId,
          eventType: row.eventType as BalanceSnapshotEvent['eventType'],
          sourceId: row.sourceId,
          postedMinor: row.postedMinor,
          inflightDebitMinor: row.inflightDebitMinor,
          inflightCreditMinor: row.inflightCreditMinor,
          effectiveAt: row.effectiveAt,
          createdAt: row.createdAt,
        }));
        const last = data[data.length - 1];
        return {
          data,
          nextCursor: hasMore && last ? this.encodeSnapshotCursor(last.effectiveAt, last.id) : null,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'get balance history');
    }
  }

  public async ingestExternalRecords(input: IngestReconRecordsInput): Promise<ReconUpload> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [upload] = await tx
          .insert(schema.reconUploads)
          .values({
            tenantId: input.tenantId,
            source: input.source,
            recordCount: input.records.length,
          })
          .returning();

        await tx.insert(schema.reconRecords).values(
          input.records.map((record) => ({
            tenantId: input.tenantId,
            uploadId: upload.id,
            externalId: record.externalId,
            source: input.source,
            amountMinor: record.amountMinor,
            currency: record.currency,
            reference: record.reference,
            description: record.description ?? null,
            occurredAt: record.occurredAt,
            raw: record.raw ?? null,
          })),
        );

        return {
          id: upload.id,
          tenantId: upload.tenantId,
          source: upload.source,
          recordCount: upload.recordCount,
          createdAt: upload.createdAt,
        };
      });
    } catch (error) {
      this.handleDatabaseError(error, 'ingest reconciliation external records');
    }
  }

  public async createReconciliationMatchingRule(input: CreateReconRuleInput): Promise<ReconRule> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [row] = await tx
          .insert(schema.reconRules)
          .values({
            tenantId: input.tenantId,
            name: input.name,
            description: input.description ?? null,
            criteria: serializeMatchingCriteria(input.criteria),
          })
          .returning();

        return toMatchingRule(row);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'create reconciliation matching rule');
    }
  }

  public async listReconciliationMatchingRules(tenantId: string): Promise<ReconRule[]> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.reconRules)
          .where(eq(schema.reconRules.tenantId, tenantId))
          .orderBy(asc(schema.reconRules.createdAt), asc(schema.reconRules.id));

        return rows.map(toMatchingRule);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'list reconciliation matching rules');
    }
  }

  public async getReconciliationMatchingRule(
    tenantId: string,
    ruleId: string,
  ): Promise<ReconRule | null> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.reconRules)
          .where(and(eq(schema.reconRules.tenantId, tenantId), eq(schema.reconRules.id, ruleId)))
          .limit(1);

        return row ? toMatchingRule(row) : null;
      });
    } catch (error) {
      this.handleDatabaseError(error, 'get reconciliation matching rule');
    }
  }

  public async runReconciliation(input: RunReconInput): Promise<ReconRun> {
    try {
      return await this.withTenantContext(input.tenantId, async (tx) => {
        const [ledger] = await tx
          .select({ id: schema.ledgers.id })
          .from(schema.ledgers)
          .where(
            and(eq(schema.ledgers.tenantId, input.tenantId), eq(schema.ledgers.id, input.ledgerId)),
          )
          .limit(1);
        if (!ledger) {
          throw new LedgerNotFoundError(input.ledgerId);
        }

        const [upload] = await tx
          .select()
          .from(schema.reconUploads)
          .where(
            and(
              eq(schema.reconUploads.tenantId, input.tenantId),
              eq(schema.reconUploads.id, input.uploadId),
            ),
          )
          .limit(1);
        if (!upload) {
          throw new InvariantViolationError('reconciliation upload was not found');
        }

        const ruleRows = await tx
          .select()
          .from(schema.reconRules)
          .where(
            and(
              eq(schema.reconRules.tenantId, input.tenantId),
              inArray(schema.reconRules.id, input.matchingRuleIds),
            ),
          )
          .orderBy(asc(schema.reconRules.createdAt), asc(schema.reconRules.id));
        if (ruleRows.length !== input.matchingRuleIds.length) {
          throw new InvariantViolationError(
            'one or more reconciliation matching rules were not found',
          );
        }

        const externalRows = await tx
          .select()
          .from(schema.reconRecords)
          .where(
            and(
              eq(schema.reconRecords.tenantId, input.tenantId),
              eq(schema.reconRecords.uploadId, input.uploadId),
            ),
          )
          .orderBy(asc(schema.reconRecords.occurredAt), asc(schema.reconRecords.externalId));
        if (externalRows.length === 0) {
          throw new InvariantViolationError('reconciliation upload has no records');
        }

        const transactionRows = await tx
          .select()
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.tenantId, input.tenantId),
              eq(schema.transactions.ledgerId, input.ledgerId),
            ),
          )
          .orderBy(asc(schema.transactions.createdAt), asc(schema.transactions.id));
        const entriesByTransactionId = await this.loadEntriesByTransactionIds(
          tx,
          input.tenantId,
          transactionRows.map((row) => row.id),
        );

        const transactions = transactionRows.map(
          (row) =>
            new TransactionEntity({
              id: new LedgerTransactionId(row.id),
              tenantId: row.tenantId,
              ledgerId: new LedgerLedgerId(row.ledgerId),
              reference: row.reference,
              currency: row.currency,
              description: row.description,
              relatedTransactionId: row.relatedTransactionId,
              relationType: row.relationType,
              createdAt: row.createdAt,
              entries: entriesByTransactionId.get(row.id) ?? [],
            }),
        );
        const decisions = reconcileOneToOne({
          externalRecords: externalRows.map(toReconRecord),
          transactions,
          rules: ruleRows.map(toMatchingRule),
        });
        const counts = this.countReconResults(decisions.map((decision) => decision.status));
        const now = new Date();
        const runId = generateUuidV7();

        const run: ReconRun = {
          id: runId,
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          uploadId: input.uploadId,
          strategy: input.strategy,
          status: 'completed',
          dryRun: input.dryRun ?? false,
          ...counts,
          startedAt: now,
          completedAt: now,
          results: decisions.map((decision) => ({
            id: generateUuidV7(),
            runId,
            externalRecordId: decision.externalRecordId ?? null,
            externalId: decision.externalId ?? null,
            transactionId: decision.transactionId ?? null,
            status: decision.status,
            reason: decision.reason,
            candidateTransactionIds: decision.candidateTransactionIds,
            createdAt: now,
          })),
        };

        if (run.dryRun) {
          return run;
        }

        await tx.insert(schema.reconRuns).values({
          id: run.id,
          tenantId: run.tenantId,
          ledgerId: run.ledgerId,
          uploadId: run.uploadId,
          strategy: run.strategy,
          status: run.status,
          dryRun: run.dryRun,
          matchedCount: run.matchedCount,
          unmatchedExternalCount: run.unmatchedExternalCount,
          unmatchedInternalCount: run.unmatchedInternalCount,
          mismatchedCount: run.mismatchedCount,
          conflictCount: run.conflictCount,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        });
        if (run.results.length > 0) {
          await tx.insert(schema.reconResults).values(
            run.results.map((result) => ({
              id: result.id,
              tenantId: input.tenantId,
              runId: run.id,
              externalRecordId: result.externalRecordId,
              externalId: result.externalId,
              transactionId: result.transactionId,
              status: result.status,
              reason: result.reason,
              candidateTransactionIds: result.candidateTransactionIds,
              createdAt: result.createdAt,
            })),
          );
        }

        return run;
      });
    } catch (error) {
      this.handleDatabaseError(error, 'run reconciliation');
    }
  }

  public async getReconciliationRun(tenantId: string, runId: string): Promise<ReconRun | null> {
    try {
      return await this.withTenantContext(tenantId, async (tx) => {
        const [run] = await tx
          .select()
          .from(schema.reconRuns)
          .where(and(eq(schema.reconRuns.tenantId, tenantId), eq(schema.reconRuns.id, runId)))
          .limit(1);
        if (!run) {
          return null;
        }

        const results = await tx
          .select()
          .from(schema.reconResults)
          .where(eq(schema.reconResults.runId, runId))
          .orderBy(asc(schema.reconResults.createdAt), asc(schema.reconResults.id));

        return this.toReconRun(run, results);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'get reconciliation run');
    }
  }

  private countReconResults(
    statuses: ReconResultStatus[],
  ): Pick<
    ReconRun,
    | 'matchedCount'
    | 'unmatchedExternalCount'
    | 'unmatchedInternalCount'
    | 'mismatchedCount'
    | 'conflictCount'
  > {
    return {
      matchedCount: statuses.filter((status) => status === 'matched').length,
      unmatchedExternalCount: statuses.filter((status) => status === 'unmatched_external').length,
      unmatchedInternalCount: statuses.filter((status) => status === 'unmatched_internal').length,
      mismatchedCount: statuses.filter((status) => status === 'mismatched').length,
      conflictCount: statuses.filter((status) => status === 'conflict').length,
    };
  }

  private toReconRun(run: ReconRunRow, resultRows: ReconResultRow[]): ReconRun {
    return {
      id: run.id,
      tenantId: run.tenantId,
      ledgerId: run.ledgerId,
      uploadId: run.uploadId,
      strategy: run.strategy as ReconStrategy,
      status: run.status,
      dryRun: run.dryRun,
      matchedCount: run.matchedCount,
      unmatchedExternalCount: run.unmatchedExternalCount,
      unmatchedInternalCount: run.unmatchedInternalCount,
      mismatchedCount: run.mismatchedCount,
      conflictCount: run.conflictCount,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      results: resultRows.map(
        (row): ReconResult => ({
          id: row.id,
          runId: row.runId,
          externalRecordId: row.externalRecordId,
          externalId: row.externalId,
          transactionId: row.transactionId,
          status: row.status,
          reason: row.reason,
          candidateTransactionIds: row.candidateTransactionIds,
          createdAt: row.createdAt,
        }),
      ),
    };
  }

  private async loadEntriesByTransactionIds(
    tx: PostgresJsDatabase<typeof schema>,
    tenantId: string,
    transactionIds: string[],
  ): Promise<Map<string, EntryEntity[]>> {
    if (transactionIds.length === 0) {
      return new Map();
    }

    const entryRows = await tx
      .select()
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.tenantId, tenantId),
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

    return entriesByTransactionId;
  }

  private async insertBalanceSnapshot(
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

  private encodeSnapshotCursor(effectiveAt: Date, id: string): string {
    const serialized = stringify({ effectiveAt: effectiveAt.toISOString(), id });
    if (serialized === undefined) {
      throw new InvariantViolationError('Invalid cursor');
    }
    return Buffer.from(serialized, 'utf8').toString('base64url');
  }

  private decodeSnapshotCursor(
    cursor: string | undefined,
  ): { effectiveAt: Date; id: string } | null {
    if (!cursor) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (
        typeof parsed.effectiveAt !== 'string' ||
        typeof parsed.id !== 'string' ||
        !isUuidV7(parsed.id)
      ) {
        throw new InvariantViolationError('Invalid cursor');
      }
      const effectiveAt = new Date(parsed.effectiveAt);
      if (Number.isNaN(effectiveAt.getTime())) {
        throw new InvariantViolationError('Invalid cursor');
      }
      return { effectiveAt, id: parsed.id };
    } catch {
      throw new InvariantViolationError('Invalid cursor');
    }
  }

  private resolveTotalDebit(
    entries: Array<{ direction: EntryDirection; amountMinor: bigint }>,
  ): bigint {
    return entries.reduce(
      (sum, entry) => (entry.direction === EntryDirection.DEBIT ? sum + entry.amountMinor : sum),
      0n,
    );
  }

  private async createOrResolvePostedTransaction(
    tx: PostgresJsDatabase<typeof schema>,
    input: {
      tenantId: string;
      ledgerId: string;
      reference: string;
      currency: string;
      description: string | null;
      relatedTransactionId?: string | null;
      relationType?: 'REVERSAL' | 'CORRECTION' | null;
      entries: Array<{
        accountId: string;
        direction: EntryDirection;
        amountMinor: bigint;
        currency: string;
      }>;
      payloadMismatchMessage: string;
    },
  ): Promise<{ transactionId: string; created: boolean }> {
    const [existing] = await tx
      .select({
        id: schema.transactions.id,
        ledgerId: schema.transactions.ledgerId,
        currency: schema.transactions.currency,
        description: schema.transactions.description,
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
    if (existing) {
      if (
        existing.ledgerId !== input.ledgerId ||
        existing.currency !== input.currency ||
        (existing.description ?? null) !== (input.description ?? null) ||
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
    const transactionId = await this.createPostedTransaction(tx, input);
    return { transactionId, created: true };
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
      entries: Array<{
        accountId: string;
        direction: EntryDirection;
        amountMinor: bigint;
        currency: string;
      }>;
    },
  ): Promise<{ transactionId: string; created: boolean }> {
    const [existing] = await tx
      .select({
        id: schema.transactions.id,
        relatedTransactionId: schema.transactions.relatedTransactionId,
        relationType: schema.transactions.relationType,
        description: schema.transactions.description,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.tenantId, input.tenantId),
          eq(schema.transactions.reference, input.reference),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.relatedTransactionId !== input.originalTransactionId ||
        existing.relationType !== 'REVERSAL' ||
        (existing.description ?? null) !== (input.description ?? null)
      ) {
        throw new InvariantViolationError(
          'Unable to reverse transaction: reference payload mismatch',
        );
      }
      return { transactionId: existing.id, created: false };
    }

    const transactionId = await this.createPostedTransaction(tx, {
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      reference: input.reference,
      currency: input.currency,
      description: input.description,
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
    await this.validateCreateTransactionInvariants(tx, input);
    const [insertedTransaction] = await tx
      .insert(schema.transactions)
      .values({
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: input.currency,
        description: input.description,
        relatedTransactionId: input.relatedTransactionId ?? null,
        relationType: input.relationType ?? null,
      })
      .returning({ id: schema.transactions.id });
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
      await this.insertBalanceSnapshot(tx, {
        tenantId: input.tenantId,
        eventType: 'TX_APPLIED',
        sourceId: insertedTransaction.id,
        accountId: updatedAccount.id,
        ledgerId: updatedAccount.ledgerId,
        postedMinor: updatedAccount.balanceMinor,
        inflightDebitMinor: updatedAccount.inflightDebitMinor,
        inflightCreditMinor: updatedAccount.inflightCreditMinor,
      });
    }
    return insertedTransaction.id;
  }

  private validateHoldEntriesInput(
    entries: Array<{
      direction: EntryDirection;
      amountMinor: bigint;
      currency: string;
    }>,
    holdCurrency: string,
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
      if (entry.currency !== holdCurrency) {
        throw new InvariantViolationError(
          'Unable to create hold: entry currency must match hold currency',
        );
      }
    }
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
