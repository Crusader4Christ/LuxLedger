import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import {
  InvariantViolationError,
  OverdraftPolicyViolationError,
  RepositoryError,
} from '@lux/ledger/application';
import { and, eq, sql } from 'drizzle-orm';
import { createDbClient } from '../../src/client';
import { DrizzleAccountRepository } from '../../src/repositories/account-repository';
import { DrizzleBalanceRepository } from '../../src/repositories/balance-repository';
import { DrizzleLedgerRepository } from '../../src/repositories/ledger-repository';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
import { accounts, balanceSnapshots, entries, transactions } from '../../src/schema';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  databaseUrl,
  createAccount as insertAccount,
  createEntry as insertEntry,
  createLedger as insertLedger,
  createTenant as insertTenant,
  createTransaction as insertTransaction,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const _accountRepository = new DrizzleAccountRepository(client);
const _balanceRepository = new DrizzleBalanceRepository(client);
const _ledgerRepository = new DrizzleLedgerRepository(client);
const transactionRepository = new DrizzleTransactionRepository(client);
const createTenant = (tenantName: string) => insertTenant(db, tenantName);
const createLedger = (tenantId: string, ledgerName: string) =>
  insertLedger(db, tenantId, ledgerName);
const createAccount = (input: Parameters<typeof insertAccount>[1]) => insertAccount(db, input);
const _createTransaction = (input: Parameters<typeof insertTransaction>[1]) =>
  insertTransaction(db, input);
const _createEntry = (input: Parameters<typeof insertEntry>[1]) => insertEntry(db, input);

describe('Drizzle transaction repository posting', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

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

    const result = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'success-ref',
      currency: 'USD',
      description: 'Initial funding',
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

    const [transactionRow] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, result.transactionId))
      .limit(1);
    expect(transactionRow?.reference).toBe('success-ref');
    expect(transactionRow?.description).toBe('Initial funding');

    const entryRows = await db
      .select()
      .from(entries)
      .where(eq(entries.transactionId, result.transactionId));
    expect(entryRows.length).toBe(2);
    expect(entryRows.every((row) => row.tenantId === tenantId)).toBeTrue();

    const [debitBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await db
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
      transactionRepository.create({
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

    const transactionRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'imbalanced-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await db.select().from(entries);
    expect(entryRows.length).toBe(0);

    const [debitBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, creditAccountId))
      .limit(1);
    expect(debitBalance?.balanceMinor).toBe(0n);
    expect(creditBalance?.balanceMinor).toBe(0n);
  });

  it('createTransaction rejects posting that would overdraft a DISALLOW account', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      overdraftPolicy: 'DISALLOW',
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
      transactionRepository.create({
        tenantId,
        ledgerId,
        reference: 'overdraft-ref',
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
      }),
    ).rejects.toBeInstanceOf(OverdraftPolicyViolationError);

    const [debitBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, creditAccountId))
      .limit(1);
    expect(debitBalance?.balanceMinor).toBe(0n);
    expect(creditBalance?.balanceMinor).toBe(0n);
  });

  it('createTransaction allows posting that would overdraft when policy is ALLOW', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      overdraftPolicy: 'ALLOW',
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

    const result = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'allow-overdraft-ref',
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

    expect(result.created).toBeTrue();

    const [debitBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    expect(debitBalance?.balanceMinor).toBe(-100n);
  });

  it('createTransaction handles idempotency conflict without duplicate effects and keeps original description', async () => {
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

    const first = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'ref-1',
      currency: 'USD',
      description: 'First description',
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

    const second = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'ref-1',
      currency: 'USD',
      description: 'Changed description on retry',
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

    const transactionRows = await db
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
    expect(transactionRows[0]?.description).toBe('First description');

    const entryRows = await db
      .select()
      .from(entries)
      .where(eq(entries.transactionId, first.transactionId));
    expect(entryRows.length).toBe(2);

    const [debitBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, creditAccountId))
      .limit(1);

    expect(debitBalance?.balanceMinor).toBe(-100n);
    expect(creditBalance?.balanceMinor).toBe(100n);
  });

  it('createTransaction serializes concurrent idempotent retries', async () => {
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
    const input = {
      tenantId,
      ledgerId,
      reference: 'ref-concurrent',
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
    };
    const clientA = createDbClient({
      databaseUrl,
      max: 1,
      idleTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    });
    const clientB = createDbClient({
      databaseUrl,
      max: 1,
      idleTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    });
    const repositoryA = new DrizzleTransactionRepository(clientA);
    const repositoryB = new DrizzleTransactionRepository(clientB);

    try {
      const results = await Promise.all([repositoryA.create(input), repositoryB.create(input)]);

      expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
      expect(results.filter((result) => result.created).length).toBe(1);
      expect(results.filter((result) => !result.created).length).toBe(1);
      expect(
        await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reference, input.reference)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: entries.id })
          .from(entries)
          .where(eq(entries.transactionId, results[0]?.transactionId as string)),
      ).toHaveLength(2);
    } finally {
      await clientA.sql.end({ timeout: 5 });
      await clientB.sql.end({ timeout: 5 });
    }
  });

  it('serializes concurrent backdated snapshot propagation per account', async () => {
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

    await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'ref-baseline',
      currency: 'USD',
      effectiveAt: new Date('2024-01-10T00:00:00.000Z'),
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

    const clientA = createDbClient({
      databaseUrl,
      max: 1,
      idleTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    });
    const clientB = createDbClient({
      databaseUrl,
      max: 1,
      idleTimeoutSeconds: 5,
      connectTimeoutSeconds: 5,
    });
    const repositoryA = new DrizzleTransactionRepository(clientA);
    const repositoryB = new DrizzleTransactionRepository(clientB);
    const createBackdated = (
      target: DrizzleTransactionRepository,
      reference: string,
      amountMinor: bigint,
    ) =>
      target.create({
        tenantId,
        ledgerId,
        reference,
        currency: 'USD',
        effectiveAt: new Date('2024-01-15T00:00:00.000Z'),
        entries: [
          {
            accountId: debitAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor,
            currency: 'USD',
          },
          {
            accountId: creditAccountId,
            direction: EntryDirection.CREDIT,
            amountMinor,
            currency: 'USD',
          },
        ],
      });

    try {
      await Promise.all([
        createBackdated(repositoryA, 'ref-concurrent-a', 25n),
        createBackdated(repositoryB, 'ref-concurrent-b', 40n),
      ]);

      const [latestSnapshot] = await db
        .select({ postedMinor: balanceSnapshots.postedMinor })
        .from(balanceSnapshots)
        .where(
          and(
            eq(balanceSnapshots.tenantId, tenantId),
            eq(balanceSnapshots.accountId, debitAccountId),
          ),
        )
        .orderBy(sql`${balanceSnapshots.effectiveAt} desc`, sql`${balanceSnapshots.id} desc`)
        .limit(1);

      expect(latestSnapshot?.postedMinor).toBe(-165n);
    } finally {
      await clientA.sql.end({ timeout: 5 });
      await clientB.sql.end({ timeout: 5 });
    }
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
      transactionRepository.create({
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

    const transactionRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'overflow-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await db.select().from(entries);
    expect(entryRows.length).toBe(0);

    const [debitBalance] = await db
      .select({ balanceMinor: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, debitAccountId))
      .limit(1);
    const [creditBalance] = await db
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
      transactionRepository.create({
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

    const transactionRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'currency-mismatch-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await db.select().from(entries);
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
      transactionRepository.create({
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

    const transactionRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, 'cross-ledger-ref'));
    expect(transactionRows.length).toBe(0);

    const entryRows = await db.select().from(entries);
    expect(entryRows.length).toBe(0);
  });
});
