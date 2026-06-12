import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@lux/ledger/application';
import { eq } from 'drizzle-orm';
import { DrizzleAccountRepository } from '../../src/repositories/account-repository';
import { DrizzleBalanceRepository } from '../../src/repositories/balance-repository';
import { DrizzleLedgerRepository } from '../../src/repositories/ledger-repository';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
import { ledgers } from '../../src/schema';
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
const ledgerRepository = new DrizzleLedgerRepository(client);
const _transactionRepository = new DrizzleTransactionRepository(client);
const createTenant = (tenantName: string) => insertTenant(db, tenantName);
const _createLedger = (tenantId: string, ledgerName: string) =>
  insertLedger(db, tenantId, ledgerName);
const _createAccount = (input: Parameters<typeof insertAccount>[1]) => insertAccount(db, input);
const _createTransaction = (input: Parameters<typeof insertTransaction>[1]) =>
  insertTransaction(db, input);
const _createEntry = (input: Parameters<typeof insertEntry>[1]) => insertEntry(db, input);

describe('Drizzle ledger repository', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('createLedger persists row', async () => {
    const tenantId = await createTenant('Tenant A');

    const created = await ledgerRepository.create({
      tenantId,
      name: 'Main ledger',
    });

    const [row] = await db.select().from(ledgers).where(eq(ledgers.id, created.id)).limit(1);

    expect(row).toBeDefined();
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.name).toBe('Main ledger');
  });

  it('createLedger maps foreign key violations to InvariantViolationError', async () => {
    await expect(
      ledgerRepository.create({
        tenantId: '00000000-0000-0000-0000-000000000001',
        name: 'Orphan ledger',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('findLedger returns null when not found', async () => {
    const result = await ledgerRepository.findById(
      '11111111-1111-4111-8111-111111111111',
      '00000000-0000-0000-0000-000000000099',
    );
    expect(result).toBeNull();
  });

  it('listLedgers returns only tenant ledgers', async () => {
    const tenantA = await createTenant('Tenant A');
    const tenantB = await createTenant('Tenant B');

    await ledgerRepository.create({ tenantId: tenantA, name: 'A-1' });
    await ledgerRepository.create({ tenantId: tenantA, name: 'A-2' });
    await ledgerRepository.create({ tenantId: tenantB, name: 'B-1' });

    const tenantLedgers = await ledgerRepository.list(tenantA);

    expect(tenantLedgers.length).toBe(2);
    expect(tenantLedgers.every((ledger) => ledger.tenantId === tenantA)).toBeTrue();
  });
});
