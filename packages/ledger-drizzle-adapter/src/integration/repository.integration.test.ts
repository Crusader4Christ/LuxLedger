import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import {
  InvariantViolationError,
  LedgerNotFoundError,
  RepositoryError,
} from '@lux/ledger/application';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDbClient } from '../client';
import { DrizzleLedgerRepository, type RepositoryLogger } from '../repository';
import { accounts, entries, ledgers, tenants, transactions } from '../schema';

const databaseUrl =
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

const client = createDbClient({
  databaseUrl,
  max: 1,
  idleTimeoutSeconds: 5,
  connectTimeoutSeconds: 5,
});

const repository = new DrizzleLedgerRepository(client.db, {
  info: () => {},
} as unknown as RepositoryLogger);

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
  side?: EntryDirection;
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
      side: input.side ?? EntryDirection.DEBIT,
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
  tenantId: string;
  transactionId: string;
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  currency: string;
  createdAt?: Date;
}): Promise<string> => {
  const [entry] = await client.db
    .insert(entries)
    .values({
      tenantId: input.tenantId,
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
    await client.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await client.db.execute(sql`CREATE SCHEMA public`);
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

  it('findLedgerByIdForTenant returns null when not found', async () => {
    const result = await repository.findLedgerByIdForTenant(
      '11111111-1111-4111-8111-111111111111',
      '00000000-0000-0000-0000-000000000099',
    );
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

  it('createAccount persists account row', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');

    const created = await repository.createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });

    const [row] = await client.db.select().from(accounts).where(eq(accounts.id, created.id)).limit(1);

    expect(row).toBeDefined();
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.ledgerId).toBe(ledgerId);
    expect(row?.name).toBe('Cash');
    expect(row?.side).toBe(EntryDirection.DEBIT);
    expect(row?.currency).toBe('USD');
  });

  it('createAccount throws LedgerNotFoundError when ledger is missing for tenant', async () => {
    const tenantId = await createTenant('Tenant A');

    await expect(
      repository.createAccount({
        tenantId,
        ledgerId: '00000000-0000-4000-8000-999999999999',
        name: 'Cash',
        side: EntryDirection.DEBIT,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });

  it('findAccountByIdForTenant enforces tenant scope', async () => {
    const tenantA = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerA = await createLedger(tenantA, 'Main A');
    const accountA = await createAccount({
      tenantId: tenantA,
      ledgerId: ledgerA,
      name: 'Cash A',
      currency: 'USD',
    });

    const ownAccount = await repository.findAccountByIdForTenant(tenantA, accountA);
    const crossTenant = await repository.findAccountByIdForTenant(tenantB, accountA);

    expect(ownAccount?.id).toBe(accountA);
    expect(crossTenant).toBeNull();
  });

  it('createTransaction persists transaction, entries, and balances on successful transaction creation', async () => {
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
      balanceMinor: 0n,
    });

    const result = await repository.createTransaction({
      tenantId,
      ledgerId,
      reference: 'success-ref',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 250n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 250n,
          currency: 'USD',
        },
      ],
    });

    expect(result.created).toBeTrue();

    const [transactionRow] = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, result.transactionId))
      .limit(1);
    expect(transactionRow?.reference).toBe('success-ref');

    const entryRows = await client.db
      .select()
      .from(entries)
      .where(eq(entries.transactionId, result.transactionId));
    expect(entryRows.length).toBe(2);
    expect(entryRows.every((row) => row.tenantId === tenantId)).toBeTrue();

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
    expect(debitBalance?.balanceMinor).toBe(-250n);
    expect(creditBalance?.balanceMinor).toBe(250n);
  });

  it('createTransaction rejects imbalanced entries', async () => {
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
      balanceMinor: 0n,
    });

    await expect(
      repository.createTransaction({
        tenantId,
        ledgerId,
        reference: 'imbalanced-ref',
        currency: 'USD',
        entries: [
          {
            accountId: debitAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 200n,
            currency: 'USD',
          },
          {
            accountId: creditAccountId,
            direction: EntryDirection.CREDIT,
            amountMinor: 100n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    const transactionRows = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'imbalanced-ref'));
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
    expect(creditBalance?.balanceMinor).toBe(0n);
  });

  it('createTransaction handles idempotency conflict without duplicate effects', async () => {
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

    const first = await repository.createTransaction({
      tenantId,
      ledgerId,
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 100n,
          currency: 'USD',
        },
      ],
    });

    const second = await repository.createTransaction({
      tenantId,
      ledgerId,
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
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

  it('createTransaction rolls back when balance update fails', async () => {
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
      repository.createTransaction({
        tenantId,
        ledgerId,
        reference: 'overflow-ref',
        currency: 'USD',
        entries: [
          {
            accountId: debitAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 1n,
            currency: 'USD',
          },
          {
            accountId: creditAccountId,
            direction: EntryDirection.CREDIT,
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

  it('createTransaction rejects currency mismatch', async () => {
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
      repository.createTransaction({
        tenantId,
        ledgerId,
        reference: 'currency-mismatch-ref',
        currency: 'USD',
        entries: [
          {
            accountId: wrongCurrencyAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 10n,
            currency: 'USD',
          },
          {
            accountId: validAccountId,
            direction: EntryDirection.CREDIT,
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

  it('createTransaction rejects cross-ledger account transaction entry', async () => {
    const tenantId = await createTenant('Tenant A');
    const sourceLedgerId = await createLedger(tenantId, 'Main');
    const otherLedgerId = await createLedger(tenantId, 'Secondary');
    const sourceAccountId = await createAccount({
      tenantId,
      ledgerId: sourceLedgerId,
      name: 'Source Ledger Account',
      currency: 'USD',
      balanceMinor: 0n,
    });
    const otherLedgerAccountId = await createAccount({
      tenantId,
      ledgerId: otherLedgerId,
      name: 'Other Ledger Account',
      currency: 'USD',
      balanceMinor: 0n,
    });

    await expect(
      repository.createTransaction({
        tenantId,
        ledgerId: sourceLedgerId,
        reference: 'cross-ledger-ref',
        currency: 'USD',
        entries: [
          {
            accountId: sourceAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 10n,
            currency: 'USD',
          },
          {
            accountId: otherLedgerAccountId,
            direction: EntryDirection.CREDIT,
            amountMinor: 10n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    const transactionRows = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'cross-ledger-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await client.db.select().from(entries);
    expect(entryRows.length).toBe(0);
  });

  it('createTransaction logs transactionId when transaction is committed', async () => {
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

    const logs: Array<{ object: Record<string, unknown>; message: string }> = [];
    const repositoryWithLogger = new DrizzleLedgerRepository(client.db, {
      info: (object: Record<string, unknown>, message: string) => {
        logs.push({ object, message });
      },
    } as unknown as RepositoryLogger);

    const result = await repositoryWithLogger.createTransaction({
      tenantId,
      ledgerId,
      reference: 'log-ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 10n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 10n,
          currency: 'USD',
        },
      ],
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.message).toBe('Transaction committed');
    expect(logs[0]?.object.transactionId).toBe(result.transactionId);
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

  it('listAccounts filters by ledgerId within tenant scope', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerMain = await createLedger(tenantId, 'Main');
    const ledgerSecondary = await createLedger(tenantId, 'Secondary');
    const tenantB = await createTenant('Tenant B');
    const tenantBLedger = await createLedger(tenantB, 'B Main');

    await createAccount({
      tenantId,
      ledgerId: ledgerMain,
      name: 'Main Cash',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createAccount({
      tenantId,
      ledgerId: ledgerSecondary,
      name: 'Secondary Revenue',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    });
    await createAccount({
      tenantId: tenantB,
      ledgerId: tenantBLedger,
      name: 'Other Tenant',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    });

    const filtered = await repository.listAccounts({
      tenantId,
      ledgerId: ledgerMain,
      limit: 10,
    });

    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0]?.name).toBe('Main Cash');
    expect(filtered.data[0]?.ledgerId).toBe(ledgerMain);
    expect(filtered.nextCursor).toBeNull();
  });

  it('listTransactions paginates by created_at and id cursor', async () => {
    const tenantId = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerId = await createLedger(tenantId, 'Main');
    const ledgerB = await createLedger(tenantB, 'Secondary');
    const tenantDebitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      currency: 'USD',
      balanceMinor: 0n,
    });
    const tenantCreditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      currency: 'USD',
      balanceMinor: 0n,
    });
    const tenantBDebitAccountId = await createAccount({
      tenantId: tenantB,
      ledgerId: ledgerB,
      name: 'Cash-B',
      currency: 'USD',
      balanceMinor: 0n,
    });
    const tenantBCreditAccountId = await createAccount({
      tenantId: tenantB,
      ledgerId: ledgerB,
      name: 'Revenue-B',
      currency: 'USD',
      balanceMinor: 0n,
    });

    const tx1 = await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:00.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId: tx1,
      accountId: tenantDebitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 100n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId: tx1,
      accountId: tenantCreditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 100n,
      currency: 'USD',
    });

    const tx2 = await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-2',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:01.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId: tx2,
      accountId: tenantDebitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 200n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId: tx2,
      accountId: tenantCreditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 200n,
      currency: 'USD',
    });

    const tx3 = await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-3',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:02.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId: tx3,
      accountId: tenantDebitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 300n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId: tx3,
      accountId: tenantCreditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 300n,
      currency: 'USD',
    });

    const txB1 = await createTransaction({
      tenantId: tenantB,
      ledgerId: ledgerB,
      reference: 'tx-b-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:10:03.000Z'),
    });
    await createEntry({
      tenantId: tenantB,
      transactionId: txB1,
      accountId: tenantBDebitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 999n,
      currency: 'USD',
    });
    await createEntry({
      tenantId: tenantB,
      transactionId: txB1,
      accountId: tenantBCreditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 999n,
      currency: 'USD',
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
      tenantId,
      transactionId,
      accountId: debitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 10n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:00.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId,
      accountId: creditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 10n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:01.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId,
      accountId: debitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 20n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:20:02.000Z'),
    });
    await createEntry({
      tenantId: tenantB,
      transactionId: txB,
      accountId: accountB,
      direction: EntryDirection.DEBIT,
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
    expect(secondPage.data[0]?.money.amountMinor).toBe(20n);
    expect(
      [...firstPage.data, ...secondPage.data].every((entry) => entry.money.amountMinor !== 999n),
    ).toBeTrue();
  });

  it('getTrialBalance returns balanced totals and account rows', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
      balanceMinor: -100n,
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      currency: 'USD',
      balanceMinor: 100n,
    });

    const trialBalance = await repository.getTrialBalance({ tenantId, ledgerId });

    expect(trialBalance.ledgerId).toBe(ledgerId);
    expect(trialBalance.totalDebitsMinor).toBe(100n);
    expect(trialBalance.totalCreditsMinor).toBe(100n);
    expect(trialBalance.accounts.length).toBe(2);

    const debitAccount = trialBalance.accounts.find(
      (account) => account.accountId === debitAccountId,
    );
    const creditAccount = trialBalance.accounts.find(
      (account) => account.accountId === creditAccountId,
    );

    expect(debitAccount?.normalBalance).toBe(EntryDirection.DEBIT);
    expect(debitAccount?.balanceMinor).toBe(100n);
    expect(debitAccount?.isContra).toBeFalse();
    expect(creditAccount?.normalBalance).toBe(EntryDirection.CREDIT);
    expect(creditAccount?.balanceMinor).toBe(100n);
    expect(creditAccount?.isContra).toBeFalse();
  });

  it('getTrialBalance marks contra accounts and computes totals by signed balance', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Debit with credit balance',
      side: EntryDirection.DEBIT,
      currency: 'USD',
      balanceMinor: 60n,
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Credit with debit balance',
      side: EntryDirection.CREDIT,
      currency: 'USD',
      balanceMinor: -60n,
    });

    const trialBalance = await repository.getTrialBalance({ tenantId, ledgerId });

    expect(trialBalance.totalDebitsMinor).toBe(60n);
    expect(trialBalance.totalCreditsMinor).toBe(60n);

    const debitAccount = trialBalance.accounts.find(
      (account) => account.accountId === debitAccountId,
    );
    const creditAccount = trialBalance.accounts.find(
      (account) => account.accountId === creditAccountId,
    );

    expect(debitAccount?.isContra).toBeTrue();
    expect(creditAccount?.isContra).toBeTrue();
  });

  it('getTrialBalance throws when totals mismatch', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');

    await createAccount({
      tenantId,
      ledgerId,
      name: 'Unbalanced debit',
      currency: 'USD',
      balanceMinor: -100n,
    });
    await createAccount({
      tenantId,
      ledgerId,
      name: 'Unbalanced credit',
      currency: 'USD',
      balanceMinor: 50n,
    });

    await expect(repository.getTrialBalance({ tenantId, ledgerId })).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  it('getTrialBalance throws LedgerNotFoundError for missing ledger', async () => {
    await expect(
      repository.getTrialBalance({
        tenantId: '11111111-1111-4111-8111-111111111111',
        ledgerId: '00000000-0000-4000-8000-000000000999',
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });

  it('getTrialBalance throws LedgerNotFoundError for ledger of another tenant', async () => {
    const tenantA = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerB = await createLedger(tenantB, 'Ledger B');

    await expect(
      repository.getTrialBalance({
        tenantId: tenantA,
        ledgerId: ledgerB,
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });
});
