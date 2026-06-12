import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import { DrizzleAccountRepository } from '../../src/repositories/account-repository';
import { DrizzleBalanceRepository } from '../../src/repositories/balance-repository';
import { DrizzleLedgerRepository } from '../../src/repositories/ledger-repository';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
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
const _accountRepository = new DrizzleAccountRepository(client);
const _balanceRepository = new DrizzleBalanceRepository(client);
const _ledgerRepository = new DrizzleLedgerRepository(client);
const transactionRepository = new DrizzleTransactionRepository(client);
const createTenant = (tenantName: string) => insertTenant(db, tenantName);
const createLedger = (tenantId: string, ledgerName: string) =>
  insertLedger(db, tenantId, ledgerName);
const createAccount = (input: Parameters<typeof insertAccount>[1]) => insertAccount(db, input);
const createTransaction = (input: Parameters<typeof insertTransaction>[1]) =>
  insertTransaction(db, input);
const createEntry = (input: Parameters<typeof insertEntry>[1]) => insertEntry(db, input);

describe('Drizzle transaction repository query', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

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
      description: 'Description tx-1',
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
      description: null,
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

    const firstPage = await transactionRepository.list({ tenantId, limit: 2 });
    expect(firstPage.data.length).toBe(2);
    expect(firstPage.nextCursor).toBeDefined();
    const firstCursor = firstPage.nextCursor;
    if (!firstCursor) {
      throw new Error('Expected next cursor for first transactions page');
    }

    const secondPage = await transactionRepository.list({
      tenantId,
      limit: 2,
      cursor: firstCursor,
    });
    expect(secondPage.data.length).toBe(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.data[0]?.reference).toBe('tx-3');
    expect(firstPage.data[0]?.description).toBe('Description tx-1');
    expect(firstPage.data[1]?.description).toBeNull();
    expect(
      [...firstPage.data, ...secondPage.data].every(
        (transaction) => transaction.tenantId === tenantId,
      ),
    ).toBeTrue();
  });

  it('findTransaction returns transaction for tenant and null for missing/cross-tenant', async () => {
    const tenantId = await createTenant('Tenant A');
    const otherTenantId = await createTenant('Tenant B');
    const ledgerId = await createLedger(tenantId, 'Main');
    const otherLedgerId = await createLedger(otherTenantId, 'Other');
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
    const otherDebitAccountId = await createAccount({
      tenantId: otherTenantId,
      ledgerId: otherLedgerId,
      name: 'Other Cash',
      currency: 'USD',
    });
    const otherCreditAccountId = await createAccount({
      tenantId: otherTenantId,
      ledgerId: otherLedgerId,
      name: 'Other Revenue',
      currency: 'USD',
    });

    const transactionId = await createTransaction({
      tenantId,
      ledgerId,
      reference: 'tx-find-1',
      currency: 'USD',
      description: 'Lookup description',
    });
    await createEntry({
      tenantId,
      transactionId,
      accountId: debitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 10n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId,
      accountId: creditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 10n,
      currency: 'USD',
    });

    const otherTransactionId = await createTransaction({
      tenantId: otherTenantId,
      ledgerId: otherLedgerId,
      reference: 'tx-find-b',
      currency: 'USD',
    });
    await createEntry({
      tenantId: otherTenantId,
      transactionId: otherTransactionId,
      accountId: otherDebitAccountId,
      direction: EntryDirection.DEBIT,
      amountMinor: 11n,
      currency: 'USD',
    });
    await createEntry({
      tenantId: otherTenantId,
      transactionId: otherTransactionId,
      accountId: otherCreditAccountId,
      direction: EntryDirection.CREDIT,
      amountMinor: 11n,
      currency: 'USD',
    });

    const found = await transactionRepository.findById(tenantId, transactionId);
    expect(found).not.toBeNull();
    expect(found?.id.value).toBe(transactionId);
    expect(found?.tenantId).toBe(tenantId);
    expect(found?.description).toBe('Lookup description');
    expect(found?.entries.length).toBe(2);

    const missing = await transactionRepository.findById(
      tenantId,
      '00000000-0000-4000-8000-999999999999',
    );
    expect(missing).toBeNull();

    const crossTenant = await transactionRepository.findById(tenantId, otherTransactionId);
    expect(crossTenant).toBeNull();
  });

  it('listTransactions filters by ledgerId within tenant scope and keeps pagination cursor contract', async () => {
    const tenantId = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerMain = await createLedger(tenantId, 'Main');
    const ledgerSecondary = await createLedger(tenantId, 'Secondary');
    const ledgerOtherTenant = await createLedger(tenantB, 'Other');
    const mainDebit = await createAccount({
      tenantId,
      ledgerId: ledgerMain,
      name: 'Main Cash',
      currency: 'USD',
    });
    const mainCredit = await createAccount({
      tenantId,
      ledgerId: ledgerMain,
      name: 'Main Revenue',
      currency: 'USD',
    });
    const secondaryDebit = await createAccount({
      tenantId,
      ledgerId: ledgerSecondary,
      name: 'Secondary Cash',
      currency: 'USD',
    });
    const secondaryCredit = await createAccount({
      tenantId,
      ledgerId: ledgerSecondary,
      name: 'Secondary Revenue',
      currency: 'USD',
    });
    const otherDebit = await createAccount({
      tenantId: tenantB,
      ledgerId: ledgerOtherTenant,
      name: 'Other Cash',
      currency: 'USD',
    });
    const otherCredit = await createAccount({
      tenantId: tenantB,
      ledgerId: ledgerOtherTenant,
      name: 'Other Revenue',
      currency: 'USD',
    });

    const mainTx1 = await createTransaction({
      tenantId,
      ledgerId: ledgerMain,
      reference: 'ledger-main-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:30:00.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId: mainTx1,
      accountId: mainDebit,
      direction: EntryDirection.DEBIT,
      amountMinor: 100n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId: mainTx1,
      accountId: mainCredit,
      direction: EntryDirection.CREDIT,
      amountMinor: 100n,
      currency: 'USD',
    });

    const mainTx2 = await createTransaction({
      tenantId,
      ledgerId: ledgerMain,
      reference: 'ledger-main-2',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:30:01.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId: mainTx2,
      accountId: mainDebit,
      direction: EntryDirection.DEBIT,
      amountMinor: 200n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId: mainTx2,
      accountId: mainCredit,
      direction: EntryDirection.CREDIT,
      amountMinor: 200n,
      currency: 'USD',
    });

    const secondaryTx = await createTransaction({
      tenantId,
      ledgerId: ledgerSecondary,
      reference: 'ledger-secondary-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:30:02.000Z'),
    });
    await createEntry({
      tenantId,
      transactionId: secondaryTx,
      accountId: secondaryDebit,
      direction: EntryDirection.DEBIT,
      amountMinor: 300n,
      currency: 'USD',
    });
    await createEntry({
      tenantId,
      transactionId: secondaryTx,
      accountId: secondaryCredit,
      direction: EntryDirection.CREDIT,
      amountMinor: 300n,
      currency: 'USD',
    });

    const otherTx = await createTransaction({
      tenantId: tenantB,
      ledgerId: ledgerOtherTenant,
      reference: 'other-tenant-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:30:03.000Z'),
    });
    await createEntry({
      tenantId: tenantB,
      transactionId: otherTx,
      accountId: otherDebit,
      direction: EntryDirection.DEBIT,
      amountMinor: 400n,
      currency: 'USD',
    });
    await createEntry({
      tenantId: tenantB,
      transactionId: otherTx,
      accountId: otherCredit,
      direction: EntryDirection.CREDIT,
      amountMinor: 400n,
      currency: 'USD',
    });

    const firstPage = await transactionRepository.list({
      tenantId,
      ledgerId: ledgerMain,
      limit: 1,
    });
    expect(firstPage.data.length).toBe(1);
    expect(firstPage.data[0]?.reference).toBe('ledger-main-1');
    expect(firstPage.data[0]?.ledgerId.value).toBe(ledgerMain);
    expect(firstPage.nextCursor).toBeDefined();

    const cursor = firstPage.nextCursor;
    if (!cursor) {
      throw new Error('Expected next cursor for ledger-filtered first page');
    }

    const secondPage = await transactionRepository.list({
      tenantId,
      ledgerId: ledgerMain,
      limit: 1,
      cursor,
    });
    expect(secondPage.data.length).toBe(1);
    expect(secondPage.data[0]?.reference).toBe('ledger-main-2');
    expect(secondPage.nextCursor).toBeNull();
    expect(
      [...firstPage.data, ...secondPage.data].every(
        (transaction) =>
          transaction.tenantId === tenantId && transaction.ledgerId.value === ledgerMain,
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

    const firstPage = await transactionRepository.listEntries({ tenantId, limit: 2 });
    expect(firstPage.data.length).toBe(2);
    expect(firstPage.nextCursor).toBeDefined();
    const firstCursor = firstPage.nextCursor;
    if (!firstCursor) {
      throw new Error('Expected next cursor for first entries page');
    }

    const secondPage = await transactionRepository.listEntries({
      tenantId,
      limit: 2,
      cursor: firstCursor,
    });
    expect(secondPage.data.length).toBe(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.data[0]?.money.amountMinor).toBe(20n);
    expect(
      [...firstPage.data, ...secondPage.data].every((entry) => entry.money.amountMinor !== 999n),
    ).toBeTrue();
  });
});
