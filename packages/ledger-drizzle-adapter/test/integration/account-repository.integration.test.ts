import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import { LedgerNotFoundError } from '@lux/ledger/application';
import { eq } from 'drizzle-orm';
import { DrizzleAccountRepository } from '../../src/repositories/account-repository';
import { DrizzleBalanceRepository } from '../../src/repositories/balance-repository';
import { DrizzleLedgerRepository } from '../../src/repositories/ledger-repository';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
import { accounts } from '../../src/schema';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
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
const accountRepository = new DrizzleAccountRepository(client);
const _balanceRepository = new DrizzleBalanceRepository(client);
const _ledgerRepository = new DrizzleLedgerRepository(client);
const _transactionRepository = new DrizzleTransactionRepository(client);
const createTenant = (tenantName: string) => insertTenant(db, tenantName);
const createLedger = (tenantId: string, ledgerName: string) =>
  insertLedger(db, tenantId, ledgerName);
const createAccount = (input: Parameters<typeof insertAccount>[1]) => insertAccount(db, input);
const _createTransaction = (input: Parameters<typeof insertTransaction>[1]) =>
  insertTransaction(db, input);
const _createEntry = (input: Parameters<typeof insertEntry>[1]) => insertEntry(db, input);

describe('Drizzle account repository', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('createAccount persists account row', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');

    const created = await accountRepository.create({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });

    const [row] = await db.select().from(accounts).where(eq(accounts.id, created.id)).limit(1);

    expect(row).toBeDefined();
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.ledgerId).toBe(ledgerId);
    expect(row?.name).toBe('Cash');
    expect(row?.side).toBe(EntryDirection.DEBIT);
    expect(row?.overdraftPolicy).toBe('ALLOW');
    expect(row?.currency).toBe('USD');
  });

  it('createAccount persists explicit DISALLOW overdraft policy', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');

    const created = await accountRepository.create({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      overdraftPolicy: 'DISALLOW',
      currency: 'USD',
    });

    const [row] = await db.select().from(accounts).where(eq(accounts.id, created.id)).limit(1);

    expect(row?.overdraftPolicy).toBe('DISALLOW');
  });

  it('createAccount throws LedgerNotFoundError when ledger is missing for tenant', async () => {
    const tenantId = await createTenant('Tenant A');

    await expect(
      accountRepository.create({
        tenantId,
        ledgerId: '00000000-0000-4000-8000-999999999999',
        name: 'Cash',
        side: EntryDirection.DEBIT,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });

  it('findAccount enforces tenant scope', async () => {
    const tenantA = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerA = await createLedger(tenantA, 'Main A');
    const accountA = await createAccount({
      tenantId: tenantA,
      ledgerId: ledgerA,
      name: 'Cash A',
      currency: 'USD',
    });

    const ownAccount = await accountRepository.findById(tenantA, accountA);
    const crossTenant = await accountRepository.findById(tenantB, accountA);

    expect(ownAccount?.id).toBe(accountA);
    expect(crossTenant).toBeNull();
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

    const firstPage = await accountRepository.list({ tenantId, limit: 2 });
    expect(firstPage.data.length).toBe(2);
    expect(firstPage.nextCursor).toBeDefined();
    const firstCursor = firstPage.nextCursor;
    if (!firstCursor) {
      throw new Error('Expected next cursor for first accounts page');
    }

    const secondPage = await accountRepository.list({ tenantId, limit: 2, cursor: firstCursor });
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

    const filtered = await accountRepository.list({
      tenantId,
      ledgerId: ledgerMain,
      limit: 10,
    });

    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0]?.name).toBe('Main Cash');
    expect(filtered.data[0]?.ledgerId).toBe(ledgerMain);
    expect(filtered.nextCursor).toBeNull();
  });
});
