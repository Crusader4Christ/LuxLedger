import { describe, expect, it } from 'bun:test';

import type { AccountEntity, EntryEntity, TransactionEntity } from '@lux/ledger';
import type {
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
  EntryDirection,
  InvariantViolationError,
  LedgerNotFoundError,
  LedgerService,
} from '@lux/ledger/application';

class InMemoryLedgerRepository implements LedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();
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

  public async listAccounts(_query: PaginationQuery): Promise<PaginatedResult<AccountEntity>> {
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
});
