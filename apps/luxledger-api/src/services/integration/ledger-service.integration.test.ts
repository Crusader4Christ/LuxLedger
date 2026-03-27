import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { AccountSide, type EntryDirection } from '@lux/ledger';
import {
  createDbClient,
  DrizzleLedgerRepository,
  type RepositoryLogger,
} from '@lux/ledger-drizzle-adapter';
import { accounts, transactions } from '@lux/ledger-drizzle-adapter/schema';
import { InvariantViolationError, RepositoryError } from '@services/errors';
import { LedgerService } from '@services/ledger-service';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

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
const service = new LedgerService(repository);

const createAccount = async (input: {
  tenantId: string;
  ledgerId: string;
  name: string;
  side: AccountSide;
  currency: string;
  balanceMinor?: bigint;
}): Promise<string> => {
  const [account] = await client.db
    .insert(accounts)
    .values({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      name: input.name,
      side: input.side,
      currency: input.currency,
      balanceMinor: input.balanceMinor ?? 0n,
    })
    .returning({ id: accounts.id });

  return account.id;
};

const getAccountBalance = async (accountId: string): Promise<bigint> => {
  const [row] = await client.db
    .select({ balanceMinor: accounts.balanceMinor })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!row) {
    throw new Error(`Account not found: ${accountId}`);
  }

  return row.balanceMinor;
};

describe('LedgerService integration (service + repository + real DB)', () => {
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

  it('covers happy-path posting, idempotency, rollback, and cross-ledger guard via service API', async () => {
    const tenant = await repository.createTenant({ name: 'Tenant A' });
    const tenantId = tenant.id;

    const primaryLedger = await service.createLedger({
      tenantId,
      name: 'Primary',
    });
    const secondaryLedger = await service.createLedger({
      tenantId,
      name: 'Secondary',
    });

    const cashAccountId = await createAccount({
      tenantId,
      ledgerId: primaryLedger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
      balanceMinor: 0n,
    });
    const revenueAccountId = await createAccount({
      tenantId,
      ledgerId: primaryLedger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      currency: 'USD',
      balanceMinor: 0n,
    });
    const overflowAccountId = await createAccount({
      tenantId,
      ledgerId: primaryLedger.id,
      name: 'Overflow',
      side: AccountSide.CREDIT,
      currency: 'USD',
      balanceMinor: 9223372036854775807n,
    });
    const secondaryLedgerAccountId = await createAccount({
      tenantId,
      ledgerId: secondaryLedger.id,
      name: 'Secondary Revenue',
      side: AccountSide.CREDIT,
      currency: 'USD',
      balanceMinor: 0n,
    });

    const happyPathEntries: Array<{
      accountId: string;
      direction: EntryDirection;
      amountMinor: bigint;
      currency: string;
    }> = [
      {
        accountId: cashAccountId,
        direction: AccountSide.DEBIT,
        amountMinor: 100n,
        currency: 'USD',
      },
      {
        accountId: revenueAccountId,
        direction: AccountSide.CREDIT,
        amountMinor: 100n,
        currency: 'USD',
      },
    ];

    const first = await service.createTransaction({
      tenantId,
      ledgerId: primaryLedger.id,
      reference: 'integration-happy',
      currency: 'USD',
      entries: happyPathEntries,
    });
    expect(first.created).toBeTrue();

    const cashAfterFirst = await getAccountBalance(cashAccountId);
    const revenueAfterFirst = await getAccountBalance(revenueAccountId);
    expect(cashAfterFirst).toBe(-100n);
    expect(revenueAfterFirst).toBe(100n);

    const retry = await service.createTransaction({
      tenantId,
      ledgerId: primaryLedger.id,
      reference: 'integration-happy',
      currency: 'USD',
      entries: happyPathEntries,
    });
    expect(retry.created).toBeFalse();
    expect(retry.transactionId).toBe(first.transactionId);

    const rowsAfterRetry = await client.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.ledgerId, primaryLedger.id),
          eq(transactions.reference, 'integration-happy'),
        ),
      );
    expect(rowsAfterRetry.length).toBe(1);
    expect(await getAccountBalance(cashAccountId)).toBe(-100n);
    expect(await getAccountBalance(revenueAccountId)).toBe(100n);

    await expect(
      service.createTransaction({
        tenantId,
        ledgerId: primaryLedger.id,
        reference: 'integration-rollback',
        currency: 'USD',
        entries: [
          {
            accountId: cashAccountId,
            direction: AccountSide.DEBIT,
            amountMinor: 1n,
            currency: 'USD',
          },
          {
            accountId: overflowAccountId,
            direction: AccountSide.CREDIT,
            amountMinor: 1n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(RepositoryError);

    const rollbackRows = await client.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.reference, 'integration-rollback'));
    expect(rollbackRows.length).toBe(0);
    expect(await getAccountBalance(cashAccountId)).toBe(-100n);
    expect(await getAccountBalance(overflowAccountId)).toBe(9223372036854775807n);

    await expect(
      service.createTransaction({
        tenantId,
        ledgerId: primaryLedger.id,
        reference: 'integration-cross-ledger',
        currency: 'USD',
        entries: [
          {
            accountId: cashAccountId,
            direction: AccountSide.DEBIT,
            amountMinor: 10n,
            currency: 'USD',
          },
          {
            accountId: secondaryLedgerAccountId,
            direction: AccountSide.CREDIT,
            amountMinor: 10n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    const crossLedgerRows = await client.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.reference, 'integration-cross-ledger'));
    expect(crossLedgerRows.length).toBe(0);
    expect(await getAccountBalance(cashAccountId)).toBe(-100n);
    expect(await getAccountBalance(secondaryLedgerAccountId)).toBe(0n);
  });
});
