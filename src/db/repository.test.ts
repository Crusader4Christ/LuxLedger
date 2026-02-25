import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { InvariantViolationError } from '@core/errors';
import { createDbClient } from '@db/client';
import { DrizzleLedgerRepository } from '@db/repository';
import { ledgers, tenants } from '@db/schema';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const databaseUrl =
  process.env.DATABASE_URL_TEST ?? 'postgresql://luxledger:luxledger@localhost:5433/luxledger_test';

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

const client = createDbClient({
  databaseUrl,
  max: 1,
  idleTimeoutSeconds: 5,
  connectTimeoutSeconds: 5,
});

const repository = new DrizzleLedgerRepository(client.db);

const createTenant = async (name: string): Promise<string> => {
  const [tenant] = await client.db.insert(tenants).values({ name }).returning({ id: tenants.id });
  return tenant.id;
};

describe('DrizzleLedgerRepository', () => {
  beforeAll(async () => {
    await client.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await client.db.execute(sql`
      DO $$
      DECLARE table_record RECORD;
      BEGIN
        FOR table_record IN
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(table_record.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await migrate(client.db, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await client.db.delete(ledgers);
    await client.db.delete(tenants);
  });

  afterAll(async () => {
    await client.sql.end({ timeout: 5 });
  });

  it('createLedger persists row', async () => {
    const tenantId = await createTenant('Tenant A');

    const created = await repository.createLedger({
      tenantId,
      name: 'Main ledger',
    });

    const [row] = await client.db.select().from(ledgers).where(eq(ledgers.id, created.id)).limit(1);

    expect(row).toBeDefined();
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.name).toBe('Main ledger');
  });

  it('createLedger maps foreign key violations to InvariantViolationError', async () => {
    await expect(
      repository.createLedger({
        tenantId: '00000000-0000-0000-0000-000000000001',
        name: 'Orphan ledger',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('findLedgerById returns null when not found', async () => {
    const result = await repository.findLedgerById('00000000-0000-0000-0000-000000000099');
    expect(result).toBeNull();
  });

  it('findLedgersByTenant returns only tenant ledgers', async () => {
    const tenantA = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');

    await repository.createLedger({ tenantId: tenantA, name: 'A-1' });
    await repository.createLedger({ tenantId: tenantA, name: 'A-2' });
    await repository.createLedger({ tenantId: tenantB, name: 'B-1' });

    const tenantLedgers = await repository.findLedgersByTenant(tenantA);

    expect(tenantLedgers.length).toBe(2);
    expect(tenantLedgers.every((ledger) => ledger.tenantId === tenantA)).toBeTrue();
  });
});
