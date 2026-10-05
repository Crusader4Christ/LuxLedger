import { isDomainError, type UnknownRecord } from '@luxledger/core';
import { InvariantViolationError, RepositoryError } from '@luxledger/core/application';
import { sql as drizzleSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import type { DatabaseErrorLike } from './repository-types';
import * as luxLedgerSchema from './schema';

type EmptyHostSchema = Record<never, never>;
type LuxLedgerSchema = typeof luxLedgerSchema;

export type DrizzleDatabase<THostSchema extends Record<string, unknown> = EmptyHostSchema> =
  PostgresJsDatabase<LuxLedgerSchema & THostSchema>;

const CONSTRAINT_VIOLATION_CODES = new Set([
  '22001',
  '22007',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
  'P0001',
]);

const isObjectRecord = (value: unknown): value is UnknownRecord =>
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
  if (isDomainError(error)) {
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

const parsePositiveInt = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

export interface CreateDbClientOptions<
  THostSchema extends Record<string, unknown> = EmptyHostSchema,
> {
  databaseUrl?: string;
  max?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
  hostSchema?: THostSchema;
}

export interface DbClient<THostSchema extends Record<string, unknown> = EmptyHostSchema> {
  sql: Sql;
  execute<T>(
    operation: string,
    action: (db: DrizzleDatabase<THostSchema>) => Promise<T>,
  ): Promise<T>;
  runTx<T>(operation: string, action: (tx: DrizzleDatabase<THostSchema>) => Promise<T>): Promise<T>;
  runTenantTx<T>(
    tenantId: string,
    operation: string,
    action: (tx: DrizzleDatabase<THostSchema>) => Promise<T>,
  ): Promise<T>;
}

export const createDbClient = <THostSchema extends Record<string, unknown> = EmptyHostSchema>(
  options: CreateDbClientOptions<THostSchema> = {},
): DbClient<THostSchema> => {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const max = options.max ?? parsePositiveInt(process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX');
  const idleTimeoutSeconds =
    options.idleTimeoutSeconds ??
    parsePositiveInt(process.env.DB_IDLE_TIMEOUT, 20, 'DB_IDLE_TIMEOUT');
  const connectTimeoutSeconds =
    options.connectTimeoutSeconds ??
    parsePositiveInt(process.env.DB_CONNECT_TIMEOUT, 10, 'DB_CONNECT_TIMEOUT');
  const hostSchema = options.hostSchema ?? {};
  const conflictingSchemaKey = Object.keys(hostSchema).find((key) => key in luxLedgerSchema);
  if (conflictingSchemaKey) {
    throw new Error(`hostSchema must not redefine LuxLedger schema key: ${conflictingSchemaKey}`);
  }

  const sql = postgres(databaseUrl, {
    max,
    idle_timeout: idleTimeoutSeconds,
    connect_timeout: connectTimeoutSeconds,
  });

  const schema = {
    ...luxLedgerSchema,
    ...hostSchema,
  } as LuxLedgerSchema & THostSchema;
  const db = drizzle(sql, { schema });

  const execute = async <T>(
    operation: string,
    action: (database: DrizzleDatabase<THostSchema>) => Promise<T>,
  ): Promise<T> => {
    try {
      return await action(db);
    } catch (error) {
      return throwDatabaseError(error, operation);
    }
  };

  const runTx = <T>(
    operation: string,
    action: (tx: DrizzleDatabase<THostSchema>) => Promise<T>,
  ): Promise<T> => execute(operation, (database) => database.transaction(action));

  const runTenantTx = <T>(
    tenantId: string,
    operation: string,
    action: (tx: DrizzleDatabase<THostSchema>) => Promise<T>,
  ): Promise<T> =>
    runTx(operation, async (tx) => {
      await tx.execute(drizzleSql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return action(tx);
    });

  return { sql, execute, runTx, runTenantTx };
};
