import { DomainError as LedgerDomainError } from '@lux/ledger';
import { InvariantViolationError, RepositoryError } from '@lux/ledger/application';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DatabaseErrorLike } from './repository-types';
import type * as schema from './schema';

export interface RepositoryLogger {
  info(context: Record<string, unknown>, message: string): void;
}

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

export const generateUuidV7 = (): string => {
  const timestampHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randomHex = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    .toString(16)
    .padStart(20, '0')
    .slice(-20);
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-7${randomHex.slice(0, 3)}-8${randomHex.slice(3, 6)}-${randomHex.slice(6, 18)}`;
};

export class DrizzleRepositoryContext {
  public constructor(
    public readonly db: PostgresJsDatabase<typeof schema>,
    public readonly logger: RepositoryLogger,
  ) {}

  public async withTenantTransaction<T>(
    tenantId: string,
    operation: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return operation(tx);
    });
  }

  public handleDatabaseError(error: unknown, operation: string): never {
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
