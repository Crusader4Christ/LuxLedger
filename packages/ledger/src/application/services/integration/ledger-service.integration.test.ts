import { describe, expect, it } from 'bun:test';
import { AccountSide, type AccountEntity, type EntryEntity, type TransactionEntity } from '../../../index';
import { EntryDirection } from '../../index';
import type {
  AccountPaginationQuery,
  CreateAccountInput,
  CreateLedgerInput,
  CreateTransactionInput,
  CreateTransactionResult,
  Ledger,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
  TrialBalance,
  TrialBalanceQuery,
} from '../../types';
import { LedgerService } from '../ledger-service';

class InMemoryLedgerRepository implements LedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly accounts = new Map<string, AccountEntity>();
  private readonly transactions: CreateTransactionInput[] = [];

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    const id = `ledger-${this.ledgers.size + 1}`;
    const now = new Date();
    const ledger: Ledger = {
      id,
      tenantId: input.tenantId,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };

    this.ledgers.set(id, ledger);
    return ledger;
  }

  public async findLedgerByIdForTenant(tenantId: string, id: string): Promise<Ledger | null> {
    const ledger = this.ledgers.get(id);
    return ledger && ledger.tenantId === tenantId ? ledger : null;
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    return [...this.ledgers.values()].filter((ledger) => ledger.tenantId === tenantId);
  }

  public async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    this.transactions.push(input);
    return {
      transactionId: `tx-${this.transactions.length}`,
      created: true,
    };
  }

  public async createAccount(input: CreateAccountInput): Promise<AccountEntity> {
    const ledger = this.ledgers.get(input.ledgerId);
    if (!ledger || ledger.tenantId !== input.tenantId) {
      throw new Error(`Ledger not found: ${input.ledgerId}`);
    }

    const id = `account-${this.accounts.size + 1}`;
    const account: AccountEntity = {
      id,
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      name: input.name,
      side: input.side,
      currency: input.currency,
      balanceMinor: 0n,
      createdAt: new Date(),
    };
    this.accounts.set(id, account);
    return account;
  }

  public async findAccountByIdForTenant(
    tenantId: string,
    accountId: string,
  ): Promise<AccountEntity | null> {
    const account = this.accounts.get(accountId);
    return account && account.tenantId === tenantId ? account : null;
  }

  public async listAccounts(
    _query: AccountPaginationQuery,
  ): Promise<PaginatedResult<AccountEntity>> {
    return { data: [], nextCursor: null };
  }

  public async listTransactions(
    _query: PaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    return { data: [], nextCursor: null };
  }

  public async listEntries(_query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    return { data: [], nextCursor: null };
  }

  public async getTrialBalance(_query: TrialBalanceQuery): Promise<TrialBalance> {
    return {
      ledgerId: 'ledger-1',
      accounts: [],
      totalDebitsMinor: 0n,
      totalCreditsMinor: 0n,
    };
  }
}

describe('LedgerService integration (service + in-memory repository)', () => {
  it('keeps tenant boundaries and delegates transaction creation', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const tenantALedger = await service.createLedger({
      tenantId: 'tenant-a',
      name: 'Main A',
    });
    await service.createLedger({
      tenantId: 'tenant-b',
      name: 'Main B',
    });

    const tenantALedgers = await service.getLedgersByTenant('tenant-a');
    expect(tenantALedgers.length).toBe(1);
    expect(tenantALedgers[0]?.id).toBe(tenantALedger.id);

    const txResult = await service.createTransaction({
      tenantId: 'tenant-a',
      ledgerId: tenantALedger.id,
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: 'account-1',
          direction: EntryDirection.DEBIT,
          amountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: 'account-2',
          direction: EntryDirection.CREDIT,
          amountMinor: 100n,
          currency: 'USD',
        },
      ],
    });

    expect(txResult.created).toBeTrue();
    expect(txResult.transactionId).toBe('tx-1');
  });

  it('creates and reads account in same tenant scope', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-a',
      name: 'Main A',
    });

    const created = await service.createAccount({
      tenantId: 'tenant-a',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });
    const found = await service.getAccountById('tenant-a', created.id);

    expect(found.id).toBe(created.id);
    expect(found.ledgerId).toBe(ledger.id);
  });
});
