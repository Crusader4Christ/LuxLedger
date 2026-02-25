import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { InvariantViolationError, RepositoryError } from '@core/errors';
import { createDbClient } from '@db/client';
import { DrizzleLedgerRepository } from '@db/repository';
import { accounts, entries, ledgers, tenants, transactions } from '@db/schema';
import { and, eq, sql } from 'drizzle-orm';
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

const createLedger = async (tenantId: string, name: string): Promise<string> => {
  const [ledger] = await client.db
    .insert(ledgers)
    .values({ tenantId, name })
    .returning({ id: ledgers.id });
  return ledger.id;
};

const createAccount = async (input: {
  tenantId: string;
  ledgerId: string;
  name: string;
  currency: string;
  balanceMinor?: bigint;
  createdAt?: Date;
}): Promise<string> => {
  const [account] = await client.db
    .insert(accounts)
    .values({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      name: input.name,
      currency: input.currency,
      balanceMinor: input.balanceMinor ?? 0n,
      createdAt: input.createdAt,
    })
    .returning({ id: accounts.id });
  return account.id;
};

const createTransaction = async (input: {
  tenantId: string;
  ledgerId: string;
  reference: string;
  currency: string;
  createdAt?: Date;
}): Promise<string> => {
  const [transaction] = await client.db
    .insert(transactions)
    .values({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      reference: input.reference,
      currency: input.currency,
      createdAt: input.createdAt,
    })
    .returning({ id: transactions.id });

  return transaction.id;
};

const createEntry = async (input: {
  transactionId: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
  currency: string;
  createdAt?: Date;
}): Promise<string> => {
  const [entry] = await client.db
    .insert(entries)
    .values({
      transactionId: input.transactionId,
      accountId: input.accountId,
      direction: input.direction,
      amountMinor: input.amountMinor,
      currency: input.currency,
      createdAt: input.createdAt,
    })
    .returning({ id: entries.id });

  return entry.id;
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
    await client.db.execute(sql`
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

  it('postTransaction is idempotent for same tenant_id and reference', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      currency: 'USD',
    });

    const first = await repository.postTransaction({
      tenantId,
      ledgerId,
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: 'DEBIT',
          amountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: 'CREDIT',
          amountMinor: 100n,
          currency: 'USD',
        },
      ],
    });

    const second = await repository.postTransaction({
      tenantId,
      ledgerId,
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: 'DEBIT',
          amountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: 'CREDIT',
          amountMinor: 100n,
          currency: 'USD',
        },
      ],
    });

    expect(first.created).toBeTrue();
    expect(second.created).toBeFalse();
    expect(first.transactionId).toBe(second.transactionId);

    const transactionRows = await client.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.reference, 'ref-1'),
          eq(transactions.ledgerId, ledgerId),
        ),
      );
    expect(transactionRows.length).toBe(1);

    const entryRows = await client.db
      .select()
      .from(entries)
      .where(eq(entries.transactionId, first.transactionId));
    expect(entryRows.length).toBe(2);

    const [debitBalance] = await client.db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await client.db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, creditAccountId))
      .limit(1);

    expect(debitBalance?.balanceMinor).toBe(-100n);
    expect(creditBalance?.balanceMinor).toBe(100n);
  });

  it('postTransaction rolls back when balance update fails', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      currency: 'USD',
      balanceMinor: 0n,
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      currency: 'USD',
      balanceMinor: 9223372036854775807n,
    });

    await expect(
      repository.postTransaction({
        tenantId,
        ledgerId,
        reference: 'overflow-ref',
        currency: 'USD',
        entries: [
          {
            accountId: debitAccountId,
            direction: 'DEBIT',
            amountMinor: 1n,
            currency: 'USD',
          },
          {
            accountId: creditAccountId,
            direction: 'CREDIT',
            amountMinor: 1n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(RepositoryError);

    const transactionRows = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'overflow-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await client.db.select().from(entries);
    expect(entryRows.length).toBe(0);

    const [debitBalance] = await client.db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await client.db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, creditAccountId))
      .limit(1);

    expect(debitBalance?.balanceMinor).toBe(0n);
    expect(creditBalance?.balanceMinor).toBe(9223372036854775807n);
  });

  it('postTransaction throws InvariantViolationError on account ledger/currency mismatch', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const wrongCurrencyAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Wrong Currency Account',
      currency: 'EUR',
      balanceMinor: 0n,
    });
    const validAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Valid USD Account',
      currency: 'USD',
      balanceMinor: 0n,
    });

    await expect(
      repository.postTransaction({
        tenantId,
        ledgerId,
        reference: 'currency-mismatch-ref',
        currency: 'USD',
        entries: [
          {
            accountId: wrongCurrencyAccountId,
            direction: 'DEBIT',
            amountMinor: 10n,
            currency: 'USD',
          },
          {
            accountId: validAccountId,
            direction: 'CREDIT',
            amountMinor: 10n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    const transactionRows = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'currency-mismatch-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await client.db.select().from(entries);
    expect(entryRows.length).toBe(0);
  });

  it('listAccounts paginates by created_at and id cursor', async () => {
    const tenantId = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerId = await createLedger(tenantId, 'Main');
    const ledgerB = await createLedger(tenantB, 'Secondary');

    await createAccount({
      tenantId,
      ledgerId,
      name: 'A1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createAccount({
      tenantId,
      ledgerId,
      name: 'A2',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    });
    await createAccount({
      tenantId,
      ledgerId,
      name: 'A3',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    });
    await createAccount({
      tenantId: tenantB,
      ledgerId: ledgerB,
      name: 'B1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:03.000Z'),
    });

    const firstPage = await repository.listAccounts({ tenantId, limit: 2 });
    expect(firstPage.data.length).toBe(2);
    expect(firstPage.nextCursor).toBeDefined();
    const firstCursor = firstPage.nextCursor;
    if (!firstCursor) {
      throw new Error('Expected next cursor for first accounts page');
    }

    const secondPage = await repository.listAccounts({ tenantId, limit: 2, cursor: firstCursor });
    expect(secondPage.data.length).toBe(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.data[0]?.name).toBe('A3');
    expect(
      [...firstPage.data, ...secondPage.data].every((account) => account.tenantId === tenantId),
    ).toBeTrue();
  });

  it('listTransactions paginates by created_at and id cursor', async () => {
    const tenantId = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerId = await createLedger(tenantId, 'Main');
    const ledgerB = await createLedger(tenantB, 'Secondary');

    await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:00.000Z'),
    });
    await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-2',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:01.000Z'),
    });
    await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-3',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:02.000Z'),
    });
    await createTransaction({
      tenantId: tenantB,
      ledgerId: ledgerB,
      reference: 'tx-b-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:03.000Z'),
    });

    const firstPage = await repository.listTransactions({ tenantId, limit: 2 });
    expect(firstPage.data.length).toBe(2);
    expect(firstPage.nextCursor).toBeDefined();
    const firstCursor = firstPage.nextCursor;
    if (!firstCursor) {
      throw new Error('Expected next cursor for first transactions page');
    }

    const secondPage = await repository.listTransactions({
      tenantId,
      limit: 2,
      cursor: firstCursor,
    });
    expect(secondPage.data.length).toBe(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.data[0]?.reference).toBe('tx-3');
    expect(
      [...firstPage.data, ...secondPage.data].every(
        (transaction) => transaction.tenantId === tenantId,
      ),
    ).toBeTrue();
  });

  it('listEntries paginates by created_at and id cursor', async () => {
    const tenantId = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerId = await createLedger(tenantId, 'Main');
    const ledgerB = await createLedger(tenantB, 'Secondary');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      currency: 'USD',
    });
    const transactionId = await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-entries',
      currency: 'USD',
    });
    const accountB = await createAccount({
      tenantId: tenantB,
      ledgerId: ledgerB,
      name: 'B Cash',
      currency: 'USD',
    });
    const txB = await createTransaction({
      tenantId: tenantB,
      ledgerId: ledgerB,
      reference: 'tx-b-entries',
      currency: 'USD',
    });

    await createEntry({
      transactionId,
      accountId: debitAccountId,
      direction: 'DEBIT',
      amountMinor: 10n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:00.000Z'),
    });
    await createEntry({
      transactionId,
      accountId: creditAccountId,
      direction: 'CREDIT',
      amountMinor: 10n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:01.000Z'),
    });
    await createEntry({
      transactionId,
      accountId: debitAccountId,
      direction: 'DEBIT',
      amountMinor: 20n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:02.000Z'),
    });
    await createEntry({
      transactionId: txB,
      accountId: accountB,
      direction: 'DEBIT',
      amountMinor: 999n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:03.000Z'),
    });

    const firstPage = await repository.listEntries({ tenantId, limit: 2 });
    expect(firstPage.data.length).toBe(2);
    expect(firstPage.nextCursor).toBeDefined();
    const firstCursor = firstPage.nextCursor;
    if (!firstCursor) {
      throw new Error('Expected next cursor for first entries page');
    }

    const secondPage = await repository.listEntries({ tenantId, limit: 2, cursor: firstCursor });
    expect(secondPage.data.length).toBe(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.data[0]?.amountMinor).toBe(20n);
    expect(
      [...firstPage.data, ...secondPage.data].every((entry) => entry.amountMinor !== 999n),
    ).toBeTrue();
  });
});
