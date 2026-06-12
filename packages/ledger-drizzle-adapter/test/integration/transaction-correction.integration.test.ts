import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { EntryDirection } from '@lux/ledger';
import { InvariantViolationError } from '@lux/ledger/application';
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
const _createTransaction = (input: Parameters<typeof insertTransaction>[1]) =>
  insertTransaction(db, input);
const _createEntry = (input: Parameters<typeof insertEntry>[1]) => insertEntry(db, input);

describe('Drizzle transaction repository correction', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('correctTransaction returns created=true when reversal exists but corrected transaction is newly created', async () => {
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
      reference: 'tx-correct-original',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 110n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 110n,
          currency: 'USD',
        },
      ],
    });

    await transactionRepository.reverse({
      tenantId,
      transactionId: original.transactionId,
      reference: 'tx-correct-reversal',
    });

    const corrected = await transactionRepository.correct({
      tenantId,
      transactionId: original.transactionId,
      reversalReference: 'tx-correct-reversal',
      correctedReference: 'tx-correct-corrected',
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

    expect(corrected.created).toBeTrue();

    const idempotentRetry = await transactionRepository.correct({
      tenantId,
      transactionId: original.transactionId,
      reversalReference: 'tx-correct-reversal',
      correctedReference: 'tx-correct-corrected',
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
    expect(idempotentRetry.created).toBeFalse();
    const correctedTransaction = await transactionRepository.findById(
      tenantId,
      corrected.correctedTransactionId,
    );
    expect(correctedTransaction?.relatedTransactionId).toBe(original.transactionId);
    expect(correctedTransaction?.relationType).toBe('CORRECTION');
  });

  it('correctTransaction rejects correctedReference payload mismatch', async () => {
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
      reference: 'tx-mismatch-original',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 80n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 80n,
          currency: 'USD',
        },
      ],
    });

    await transactionRepository.create({
      tenantId,
      ledgerId,
      reference: 'tx-mismatch-corrected',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 90n,
          currency: 'USD',
        },
        {
          accountId: creditAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 90n,
          currency: 'USD',
        },
      ],
    });

    await expect(
      transactionRepository.correct({
        tenantId,
        transactionId: original.transactionId,
        reversalReference: 'tx-mismatch-reversal',
        correctedReference: 'tx-mismatch-corrected',
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
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('correctTransaction rejects no-op corrected entries', async () => {
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
      reference: 'tx-noop-original',
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

    await expect(
      transactionRepository.correct({
        tenantId,
        transactionId: original.transactionId,
        reversalReference: 'tx-noop-reversal',
        correctedReference: 'tx-noop-corrected',
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
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
