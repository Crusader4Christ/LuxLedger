import * as schema from '@db/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

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

export interface CreateDbClientOptions {
  databaseUrl?: string;
  max?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

export interface DbClient {
  db: PostgresJsDatabase<typeof schema>;
  sql: Sql;
}

export const createDbClient = (options: CreateDbClientOptions = {}): DbClient => {
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

  const sql = postgres(databaseUrl, {
    max,
    idle_timeout: idleTimeoutSeconds,
    connect_timeout: connectTimeoutSeconds,
  });

  const db = drizzle(sql, { schema });

  return { db, sql };
};
