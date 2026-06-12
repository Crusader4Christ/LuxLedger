import type { EntryDirection } from '@lux/ledger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDbClient, type DbClient } from '../../src/client';
import * as schema from '../../src/schema';

export const databaseUrl =
  process.env.DATABASE_URL_TEST ?? 'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test';

const assertSafeTestDatabaseUrl = (value: string): void => {
  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\/+/, '');
  const normalized = databaseName.toLowerCase();

  if (databaseName.length === 0) {
    throw new Error('Unsafe DATABASE_URL_TEST: database name is missing');
  }

  if (normalized === 'luxledger' || !normalized.includes('test')) {
    throw new Error(
      `Unsafe DATABASE_URL_TEST: expected a test database name, got "${databaseName}"`,
    );
  }
};

assertSafeTestDatabaseUrl(databaseUrl);

export const createRepositoryTestClient = (): DbClient =>
  createDbClient({
    databaseUrl,
    max: 1,
    idleTimeoutSeconds: 5,
    connectTimeoutSeconds: 5,
  });

export const createRepositoryTestDatabase = (client: DbClient) => drizzle(client.sql, { schema });

export type RepositoryTestDatabase = ReturnType<typeof createRepositoryTestDatabase>;

export const migrateTestDatabase = async (db: RepositoryTestDatabase): Promise<void> => {
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: 'drizzle' });
};

export const truncateTestDatabase = async (db: RepositoryTestDatabase): Promise<void> => {
  await db.execute(sql`
    DO $$
    DECLARE tables_to_truncate text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
      INTO tables_to_truncate
      FROM pg_tables
      WHERE schemaname = 'public';

      IF tables_to_truncate IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables_to_truncate || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `);
};

export const createTenant = async (db: RepositoryTestDatabase, name: string): Promise<string> => {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name })
    .returning({ id: schema.tenants.id });
  return tenant.id;
};

export const createLedger = async (
  db: RepositoryTestDatabase,
  tenantId: string,
  name: string,
): Promise<string> => {
  const [ledger] = await db
    .insert(schema.ledgers)
    .values({ tenantId, name })
    .returning({ id: schema.ledgers.id });
  return ledger.id;
};

export const createAccount = async (
  db: RepositoryTestDatabase,
  input: {
    tenantId: string;
    ledgerId: string;
    name: string;
    side?: EntryDirection;
    overdraftPolicy?: 'ALLOW' | 'DISALLOW';
    currency: string;
    balanceMinor?: bigint;
    createdAt?: Date;
  },
): Promise<string> => {
  const [account] = await db
    .insert(schema.accounts)
    .values({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      name: input.name,
      side: input.side ?? 'DEBIT',
      overdraftPolicy: input.overdraftPolicy ?? 'ALLOW',
      currency: input.currency,
      balanceMinor: input.balanceMinor ?? 0n,
      createdAt: input.createdAt,
    })
    .returning({ id: schema.accounts.id });
  return account.id;
};

export const createTransaction = async (
  db: RepositoryTestDatabase,
  input: {
    tenantId: string;
    ledgerId: string;
    reference: string;
    currency: string;
    description?: string | null;
    createdAt?: Date;
  },
): Promise<string> => {
  const [transaction] = await db
    .insert(schema.transactions)
    .values({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      reference: input.reference,
      currency: input.currency,
      description: input.description ?? null,
      createdAt: input.createdAt,
    })
    .returning({ id: schema.transactions.id });
  return transaction.id;
};

export const createEntry = async (
  db: RepositoryTestDatabase,
  input: {
    tenantId: string;
    transactionId: string;
    accountId: string;
    direction: EntryDirection;
    amountMinor: bigint;
    currency: string;
    createdAt?: Date;
  },
): Promise<string> => {
  const [entry] = await db
    .insert(schema.entries)
    .values(input)
    .returning({ id: schema.entries.id });
  return entry.id;
};
