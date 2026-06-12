import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import { LedgerNotFoundError, RepositoryError } from '@lux/ledger/application';
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
const balanceRepository = new DrizzleBalanceRepository(client);
const _ledgerRepository = new DrizzleLedgerRepository(client);
const _transactionRepository = new DrizzleTransactionRepository(client);
const createTenant = (tenantName: string) => insertTenant(db, tenantName);
const createLedger = (tenantId: string, ledgerName: string) =>
  insertLedger(db, tenantId, ledgerName);
const createAccount = (input: Parameters<typeof insertAccount>[1]) => insertAccount(db, input);
const _createTransaction = (input: Parameters<typeof insertTransaction>[1]) =>
  insertTransaction(db, input);
const _createEntry = (input: Parameters<typeof insertEntry>[1]) => insertEntry(db, input);

describe('Drizzle balance repository', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('getLedgerTrialBalance returns balanced totals and account rows', async () => {
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

    const trialBalance = await balanceRepository.getTrialBalance({ tenantId, ledgerId });

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

  it('getLedgerTrialBalance marks contra accounts and computes totals by signed balance', async () => {
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

    const trialBalance = await balanceRepository.getTrialBalance({ tenantId, ledgerId });

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

  it('getLedgerTrialBalance throws when totals mismatch', async () => {
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

    await expect(balanceRepository.getTrialBalance({ tenantId, ledgerId })).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  it('getLedgerTrialBalance throws LedgerNotFoundError for missing ledger', async () => {
    await expect(
      balanceRepository.getTrialBalance({
        tenantId: '11111111-1111-4111-8111-111111111111',
        ledgerId: '00000000-0000-4000-8000-000000000999',
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });

  it('getLedgerTrialBalance throws LedgerNotFoundError for ledger of another tenant', async () => {
    const tenantA = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');
    const ledgerB = await createLedger(tenantB, 'Ledger B');

    await expect(
      balanceRepository.getTrialBalance({
        tenantId: tenantA,
        ledgerId: ledgerB,
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });
});
