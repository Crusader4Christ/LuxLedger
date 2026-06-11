import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { AccountSide, type EntryDirection } from '@lux/ledger';
import {
  BulkTransactionError,
  InvariantViolationError,
  RepositoryError,
} from '@lux/ledger/application';
import {
  createApplicationServices,
  createDbClient,
  DrizzleTenantRepository,
  type RepositoryLogger,
} from '@lux/ledger-drizzle-adapter';
import {
  accounts,
  reconRuns,
  reconUploads,
  transactions,
} from '@lux/ledger-drizzle-adapter/schema';
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

const logger = {
  info: () => {},
} as unknown as RepositoryLogger;
const services = createApplicationServices(client.db, logger);
const tenants = new DrizzleTenantRepository(client.db);

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

describe('application services integration (services + repositories + real DB)', () => {
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
    const tenant = await tenants.create({ name: 'Tenant A' });
    const tenantId = tenant.id;

    const primaryLedger = await services.ledgers.create({
      tenantId,
      name: 'Primary',
    });
    const secondaryLedger = await services.ledgers.create({
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

    const first = await services.transactions.create({
      tenantId,
      ledgerId: primaryLedger.id,
      reference: 'integration-happy',
      currency: 'USD',
      description: 'Original integration description',
      entries: happyPathEntries,
    });
    expect(first.created).toBeTrue();

    const cashAfterFirst = await getAccountBalance(cashAccountId);
    const revenueAfterFirst = await getAccountBalance(revenueAccountId);
    expect(cashAfterFirst).toBe(-100n);
    expect(revenueAfterFirst).toBe(100n);

    const retry = await services.transactions.create({
      tenantId,
      ledgerId: primaryLedger.id,
      reference: 'integration-happy',
      currency: 'USD',
      description: 'Changed integration description on retry',
      entries: happyPathEntries,
    });
    expect(retry.created).toBeFalse();
    expect(retry.transactionId).toBe(first.transactionId);

    const rowsAfterRetry = await client.db
      .select({ id: transactions.id, description: transactions.description })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.ledgerId, primaryLedger.id),
          eq(transactions.reference, 'integration-happy'),
        ),
      );
    expect(rowsAfterRetry.length).toBe(1);
    expect(rowsAfterRetry[0]?.description).toBe('Original integration description');
    expect(await getAccountBalance(cashAccountId)).toBe(-100n);
    expect(await getAccountBalance(revenueAccountId)).toBe(100n);

    await expect(
      services.transactions.create({
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
      services.transactions.create({
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

  it('applies backdated transactions to historical balances and later snapshots', async () => {
    const tenant = await tenants.create({ name: 'Tenant Backdated' });
    const ledger = await services.ledgers.create({
      tenantId: tenant.id,
      name: 'Backdated',
    });
    const cashAccountId = await createAccount({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });
    const revenueAccountId = await createAccount({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      currency: 'USD',
    });

    const entries = (amountMinor: bigint) => [
      {
        accountId: cashAccountId,
        direction: AccountSide.DEBIT,
        amountMinor,
        currency: 'USD',
      },
      {
        accountId: revenueAccountId,
        direction: AccountSide.CREDIT,
        amountMinor,
        currency: 'USD',
      },
    ];

    await services.transactions.create({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      reference: 'jan-10',
      currency: 'USD',
      effectiveAt: new Date('2024-01-10T00:00:00.000Z'),
      entries: entries(100n),
    });
    await services.transactions.create({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      reference: 'jan-20',
      currency: 'USD',
      effectiveAt: new Date('2024-01-20T00:00:00.000Z'),
      entries: entries(50n),
    });
    await services.transactions.create({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      reference: 'jan-15-backdated',
      currency: 'USD',
      effectiveAt: new Date('2024-01-15T00:00:00.000Z'),
      entries: entries(25n),
    });

    const beforeFirst = await services.balances.getAt({
      tenantId: tenant.id,
      accountId: cashAccountId,
      at: new Date('2024-01-09T23:59:59.000Z'),
    });
    const afterBackdated = await services.balances.getAt({
      tenantId: tenant.id,
      accountId: cashAccountId,
      at: new Date('2024-01-16T00:00:00.000Z'),
    });
    const afterLater = await services.balances.getAt({
      tenantId: tenant.id,
      accountId: cashAccountId,
      at: new Date('2024-01-21T00:00:00.000Z'),
    });

    expect(beforeFirst.postedMinor).toBe(0n);
    expect(afterBackdated.postedMinor).toBe(-125n);
    expect(afterLater.postedMinor).toBe(-175n);
    expect(await getAccountBalance(cashAccountId)).toBe(-175n);
  });

  it('rolls back every item in a bulk posting when one item fails', async () => {
    const tenant = await tenants.create({ name: 'Tenant Bulk' });
    const ledger = await services.ledgers.create({
      tenantId: tenant.id,
      name: 'Bulk',
    });
    const cashAccountId = await createAccount({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });
    const revenueAccountId = await createAccount({
      tenantId: tenant.id,
      ledgerId: ledger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      currency: 'USD',
    });

    const error = await services.transactions
      .createBulk({
        tenantId: tenant.id,
        transactions: [
          {
            tenantId: tenant.id,
            ledgerId: ledger.id,
            reference: 'bulk-valid',
            currency: 'USD',
            entries: [
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
            ],
          },
          {
            tenantId: tenant.id,
            ledgerId: ledger.id,
            reference: 'bulk-invalid',
            currency: 'USD',
            entries: [
              {
                accountId: cashAccountId,
                direction: AccountSide.DEBIT,
                amountMinor: 50n,
                currency: 'USD',
              },
              {
                accountId: '00000000-0000-4000-8000-000000000999',
                direction: AccountSide.CREDIT,
                amountMinor: 50n,
                currency: 'USD',
              },
            ],
          },
        ],
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkTransactionError);
    expect((error as BulkTransactionError).details).toEqual({
      item_index: 1,
      reference: 'bulk-invalid',
      category: 'VALIDATION',
    });

    const rows = await client.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.tenantId, tenant.id));
    expect(rows.length).toBe(0);
    expect(await getAccountBalance(cashAccountId)).toBe(0n);
    expect(await getAccountBalance(revenueAccountId)).toBe(0n);
  });

  it('runs baseline reconciliation with persisted report, mismatches, conflicts, and dry-run', async () => {
    const tenant = await tenants.create({ name: 'Reconciliation Tenant' });
    const tenantId = tenant.id;
    const ledger = await services.ledgers.create({ tenantId, name: 'Primary' });

    const cashAccountId = await createAccount({
      tenantId,
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });
    const revenueAccountId = await createAccount({
      tenantId,
      ledgerId: ledger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      currency: 'USD',
    });
    const entries = (amountMinor: bigint) => [
      {
        accountId: cashAccountId,
        direction: AccountSide.DEBIT as EntryDirection,
        amountMinor,
        currency: 'USD',
      },
      {
        accountId: revenueAccountId,
        direction: AccountSide.CREDIT as EntryDirection,
        amountMinor,
        currency: 'USD',
      },
    ];

    await services.transactions.create({
      tenantId,
      ledgerId: ledger.id,
      reference: 'exact-1',
      currency: 'USD',
      entries: entries(100n),
    });
    await services.transactions.create({
      tenantId,
      ledgerId: ledger.id,
      reference: 'mismatch-1',
      currency: 'USD',
      entries: entries(200n),
    });
    await services.transactions.create({
      tenantId,
      ledgerId: ledger.id,
      reference: 'settle-a',
      currency: 'USD',
      entries: entries(50n),
    });
    await services.transactions.create({
      tenantId,
      ledgerId: ledger.id,
      reference: 'settle-b',
      currency: 'USD',
      entries: entries(50n),
    });

    const upload = await services.reconciliation.ingest({
      tenantId,
      source: 'bank-feed',
      records: [
        {
          externalId: 'ext-1',
          reference: 'exact-1',
          amountMinor: 100n,
          currency: 'USD',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          raw: { line: 1 },
        },
        {
          externalId: 'ext-2',
          reference: 'mismatch-1',
          amountMinor: 201n,
          currency: 'USD',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          externalId: 'ext-3',
          reference: 'missing-1',
          amountMinor: 300n,
          currency: 'USD',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          externalId: 'ext-4',
          reference: 'settle',
          amountMinor: 50n,
          currency: 'USD',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const exactRule = await services.reconciliation.createRule({
      tenantId,
      name: 'Baseline exact with contains reference',
      criteria: [
        { field: 'reference', operator: 'contains' },
        { field: 'amount', operator: 'equals' },
        { field: 'currency', operator: 'equals' },
      ],
    });

    const run = await services.reconciliation.run({
      tenantId,
      ledgerId: ledger.id,
      uploadId: upload.id,
      strategy: 'one_to_one',
      matchingRuleIds: [exactRule.id],
    });

    expect(run.status).toBe('completed');
    expect(run.matchedCount).toBe(1);
    expect(run.mismatchedCount).toBe(1);
    expect(run.unmatchedExternalCount).toBe(1);
    expect(run.unmatchedInternalCount).toBe(3);
    expect(run.conflictCount).toBe(1);
    expect(
      run.results.some((result) => result.externalId === 'ext-1' && result.status === 'matched'),
    ).toBeTrue();
    expect(
      run.results.some(
        (result) =>
          result.externalId === 'ext-4' &&
          result.status === 'conflict' &&
          result.reason === 'multiple_internal_candidates',
      ),
    ).toBeTrue();

    const persisted = await services.reconciliation.getRun(tenantId, run.id);
    expect(persisted.results).toHaveLength(run.results.length);

    const beforeDryRunRows = await client.db.select({ id: reconRuns.id }).from(reconRuns);
    const dryRun = await services.reconciliation.run({
      tenantId,
      ledgerId: ledger.id,
      uploadId: upload.id,
      strategy: 'one_to_one',
      matchingRuleIds: [exactRule.id],
      dryRun: true,
    });
    const afterDryRunRows = await client.db.select({ id: reconRuns.id }).from(reconRuns);
    expect(dryRun.dryRun).toBeTrue();
    expect(afterDryRunRows).toHaveLength(beforeDryRunRows.length);
  });

  it('rejects reconciliation when a persisted upload has no records', async () => {
    const tenant = await tenants.create({ name: 'Empty Upload Tenant' });
    const tenantId = tenant.id;
    const ledger = await services.ledgers.create({ tenantId, name: 'Primary' });
    const [upload] = await client.db
      .insert(reconUploads)
      .values({ tenantId, source: 'bank-feed', recordCount: 0 })
      .returning({ id: reconUploads.id });
    const rule = await services.reconciliation.createRule({
      tenantId,
      name: 'Exact',
      criteria: [{ field: 'reference', operator: 'equals' }],
    });

    await expect(
      services.reconciliation.run({
        tenantId,
        ledgerId: ledger.id,
        uploadId: upload.id,
        strategy: 'one_to_one',
        matchingRuleIds: [rule.id],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
