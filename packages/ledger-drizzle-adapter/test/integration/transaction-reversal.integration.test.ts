import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import { InvariantViolationError } from '@lux/ledger/application';
import { createDbClient } from '../../src/client';
import { DrizzleAccountRepository } from '../../src/repositories/account-repository';
import { DrizzleBalanceRepository } from '../../src/repositories/balance-repository';
import { DrizzleLedgerRepository } from '../../src/repositories/ledger-repository';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
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

describe('Drizzle transaction repository reversal', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('reverseTransaction is idempotent and links reversal to original without mutating original', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      currency: 'USD',
    });
    const created = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'tx-original',
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

    const first = await transactionRepository.reverse({
      tenantId,
      transactionId: created.transactionId,
      reference: 'tx-original-reversal',
    });
    const second = await transactionRepository.reverse({
      tenantId,
      transactionId: created.transactionId,
      reference: 'tx-original-reversal',
    });

    expect(first.created).toBeTrue();
    expect(second.created).toBeFalse();
    expect(first.transactionId).toBe(second.transactionId);

    const original = await transactionRepository.findById(tenantId, created.transactionId);
    const reversal = await transactionRepository.findById(tenantId, first.transactionId);
    expect(original?.relatedTransactionId).toBeNull();
    expect(original?.relationType).toBeNull();
    expect(reversal?.relatedTransactionId).toBe(created.transactionId);
    expect(reversal?.relationType).toBe('REVERSAL');
  });

  it('reverseTransaction rejects reversing a reversal transaction', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      currency: 'USD',
    });
    const original = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'tx-chain-original',
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
    const reversal = await transactionRepository.reverse({
      tenantId,
      transactionId: original.transactionId,
      reference: 'tx-chain-reversal',
    });

    await expect(
      transactionRepository.reverse({
        tenantId,
        transactionId: reversal.transactionId,
        reference: 'tx-chain-reversal-of-reversal',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('reverseTransaction serializes concurrent idempotent reversal attempts', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      currency: 'USD',
    });
    const original = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'tx-concurrent-original',
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
      const results = await Promise.all([
        repositoryA.reverse({
          tenantId,
          transactionId: original.transactionId,
          reference: 'tx-concurrent-reversal',
        }),
        repositoryB.reverse({
          tenantId,
          transactionId: original.transactionId,
          reference: 'tx-concurrent-reversal',
        }),
      ]);

      expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
      expect(results.filter((result) => result.created).length).toBe(1);
      expect(results.filter((result) => !result.created).length).toBe(1);
    } finally {
      await clientA.sql.end({ timeout: 5 });
      await clientB.sql.end({ timeout: 5 });
    }
  });

  it('reverseTransaction rejects idempotent reference payload mismatch', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      currency: 'USD',
    });
    const original = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'tx-reverse-mismatch-original',
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
    await transactionRepository.reverse({
      tenantId,
      transactionId: original.transactionId,
      reference: 'tx-reverse-mismatch-reversal',
      description: 'first reason',
    });

    await expect(
      transactionRepository.reverse({
        tenantId,
        transactionId: original.transactionId,
        reference: 'tx-reverse-mismatch-reversal',
        description: 'different reason',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('reverseTransaction rejects a different reference when the original is already reversed', async () => {
    const tenantId = await createTenant('Tenant A');
    const ledgerId = await createLedger(tenantId, 'Main');
    const debitAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Cash',
      side: EntryDirection.DEBIT,
      currency: 'USD',
    });
    const creditAccountId = await createAccount({
      tenantId,
      ledgerId,
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      currency: 'USD',
    });
    const original = await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'tx-reverse-reference-original',
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
    await transactionRepository.reverse({
      tenantId,
      transactionId: original.transactionId,
      reference: 'tx-reverse-reference-first',
    });

    await expect(
      transactionRepository.reverse({
        tenantId,
        transactionId: original.transactionId,
        reference: 'tx-reverse-reference-second',
      }),
    ).rejects.toThrow('Unable to reverse transaction: reference payload mismatch');
  });
});
