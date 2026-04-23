import { describe, expect, it } from 'bun:test';

import { AccountSide, type AccountEntity, type EntryEntity, type TransactionEntity } from '@lux/ledger';
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
} from '@lux/ledger/application';
import {
  AccountNotFoundError,
  EntryDirection,
  InvariantViolationError,
  LedgerNotFoundError,
  LedgerService,
} from '@lux/ledger/application';

class InMemoryLedgerRepository implements LedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly accounts = new Map<string, AccountEntity>();
  public createTransactionCalls: CreateTransactionInput[] = [];

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    const now = new Date();
    const id = `ledger-${this.ledgers.size + 1}`;
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
    this.createTransactionCalls.push(input);
    return {
      transactionId: 'tx-1',
      created: true,
    };
  }

  public async createAccount(input: CreateAccountInput): Promise<AccountEntity> {
    const ledger = this.ledgers.get(input.ledgerId);
    if (!ledger || ledger.tenantId !== input.tenantId) {
      throw new LedgerNotFoundError(input.ledgerId);
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
    query: AccountPaginationQuery,
  ): Promise<PaginatedResult<AccountEntity>> {
    const data = [...this.accounts.values()].filter((account) => {
      if (account.tenantId !== query.tenantId) {
        return false;
      }

      if (query.ledgerId !== undefined && account.ledgerId !== query.ledgerId) {
        return false;
      }

      return true;
    });

    return { data, nextCursor: null };
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

describe('LedgerService', () => {
  it('createLedger returns entity', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const ledger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Cash',
    });

    expect(ledger.id).toBe('ledger-1');
    expect(ledger.tenantId).toBe('tenant-1');
    expect(ledger.name).toBe('Cash');
  });

  it('createLedger throws InvariantViolationError for empty tenantId', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(service.createLedger({ tenantId: '  ', name: 'Cash' })).rejects.toBeInstanceOf(
      InvariantViolationError,
    );
  });

  it('getLedgerById returns correct ledger', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const created = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Cash',
    });

    const found = await service.getLedgerById('tenant-1', created.id);

    expect(found.id).toBe(created.id);
    expect(found.tenantId).toBe('tenant-1');
  });

  it('getLedgerById throws LedgerNotFoundError if not found', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(service.getLedgerById('tenant-1', 'missing-ledger')).rejects.toBeInstanceOf(
      LedgerNotFoundError,
    );
  });

  it('getLedgerById throws LedgerNotFoundError for another tenant ledger', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const created = await service.createLedger({
      tenantId: 'tenant-a',
      name: 'Cash',
    });

    await expect(service.getLedgerById('tenant-b', created.id)).rejects.toBeInstanceOf(
      LedgerNotFoundError,
    );
  });

  it('getLedgersByTenant throws InvariantViolationError for empty tenantId', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(service.getLedgersByTenant('')).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('createTransaction delegates to repository', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const result = await service.createTransaction({
      tenantId: 'tenant-1',
      ledgerId: 'ledger-1',
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

    expect(result.transactionId).toBe('tx-1');
    expect(repository.createTransactionCalls).toHaveLength(1);
  });

  it('createTransaction validates required fields', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.createTransaction({
        tenantId: '',
        ledgerId: 'ledger-1',
        reference: 'ref-1',
        currency: 'USD',
        entries: [],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('createAccount creates account when ledger exists for tenant', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Main',
    });

    const account = await service.createAccount({
      tenantId: 'tenant-1',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });

    expect(account.id).toBe('account-1');
    expect(account.tenantId).toBe('tenant-1');
    expect(account.ledgerId).toBe(ledger.id);
  });

  it('createAccount rejects unknown tenant ledger', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const tenantALedger = await service.createLedger({
      tenantId: 'tenant-a',
      name: 'Main A',
    });

    await expect(
      service.createAccount({
        tenantId: 'tenant-b',
        ledgerId: tenantALedger.id,
        name: 'Cash',
        side: AccountSide.DEBIT,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(LedgerNotFoundError);
  });

  it('createAccount validates side at service layer', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Main',
    });

    await expect(
      service.createAccount({
        tenantId: 'tenant-1',
        ledgerId: ledger.id,
        name: 'Cash',
        side: 'INVALID' as AccountSide,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('getAccountById returns account for tenant', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Main',
    });
    const created = await service.createAccount({
      tenantId: 'tenant-1',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });

    const found = await service.getAccountById('tenant-1', created.id);
    expect(found.id).toBe(created.id);
  });

  it('getAccountById throws AccountNotFoundError for missing/cross-tenant account', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-a',
      name: 'Main',
    });
    const created = await service.createAccount({
      tenantId: 'tenant-a',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });

    await expect(service.getAccountById('tenant-b', created.id)).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  it('listAccounts supports tenant-scoped ledger filter', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const tenantLedger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Main',
    });
    const otherLedger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Secondary',
    });
    await service.createAccount({
      tenantId: 'tenant-1',
      ledgerId: tenantLedger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });
    await service.createAccount({
      tenantId: 'tenant-1',
      ledgerId: otherLedger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      currency: 'USD',
    });

    const filtered = await service.listAccounts({
      tenantId: 'tenant-1',
      limit: 50,
      ledgerId: tenantLedger.id,
    });

    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0]?.name).toBe('Cash');
  });
});
