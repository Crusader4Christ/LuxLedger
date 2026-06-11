import { DomainError as LedgerDomainError } from '@lux/ledger';
import { InvariantViolationError, RepositoryError } from '@lux/ledger/application';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DatabaseErrorLike } from './repository-types';
import type * as schema from './schema';

export type DrizzleDatabase = PostgresJsDatabase<typeof schema>;

const CONSTRAINT_VIOLATION_CODES = new Set([
  '22001',
  '22007',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
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

  return 'cause' in error ? extractDatabaseCode(dbError.cause) : null;
};

const throwDatabaseError = (error: unknown, operation: string): never => {
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
};

export const executeDatabaseOperation = async <T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> => {
  try {
    return await execute();
  } catch (error) {
    return throwDatabaseError(error, operation);
  }
};

export const withTenantTransaction = <T>(
  db: DrizzleDatabase,
  tenantId: string,
  operation: string,
  execute: (tx: DrizzleDatabase) => Promise<T>,
): Promise<T> =>
  executeDatabaseOperation(operation, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return execute(tx);
    }),
  );
