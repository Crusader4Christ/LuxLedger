import { describe, expect, it } from 'bun:test';

import {
  type AccountEntity,
  AccountId,
  AccountSide,
  EntryEntity,
  LedgerId,
  Money,
  TransactionEntity,
  TransactionId,
} from '@lux/ledger';
import {
  AccountNotFoundError,
  type AccountPaginationQuery,
  type BalanceAtQuery,
  type BalanceHistoryQuery,
  type BalanceSnapshotEvent,
  type CreateAccountInput,
  type CreateLedgerInput,
  type CreateReconciliationMatchingRuleInput,
  type CreateTransactionInput,
  type CreateTransactionResult,
  EntryDirection,
  type HistoricalBalance,
  type IngestExternalRecordsInput,
  InvariantViolationError,
  type Ledger,
  LedgerNotFoundError,
  type LedgerRepository,
  LedgerService,
  type LedgerTrialBalanceQuery,
  type PaginatedResult,
  type PaginationQuery,
  type ReconciliationExternalUpload,
  type ReconciliationMatchingRule,
  type ReconciliationRun,
  type RunReconciliationInput,
  TransactionNotFoundError,
  type TransactionPaginationQuery,
  type TrialBalance,
} from '@lux/ledger/application';

class InMemoryLedgerRepository implements LedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly accounts = new Map<string, AccountEntity>();
  private readonly transactions = new Map<string, TransactionEntity>();
  public createTransactionCalls: CreateTransactionInput[] = [];
  public getBalanceAtCalls: BalanceAtQuery[] = [];
  public listBalanceHistoryCalls: BalanceHistoryQuery[] = [];

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
    const transactionId = `tx-${this.createTransactionCalls.length}`;
    const transaction = new TransactionEntity({
      id: new TransactionId(transactionId),
      tenantId: input.tenantId,
      ledgerId: new LedgerId(input.ledgerId),
      reference: input.reference,
      currency: input.currency,
      description: input.description ?? null,
      createdAt: new Date(),
      entries: input.entries.map(
        (entry) =>
          new EntryEntity({
            accountId: new AccountId(entry.accountId),
            direction: entry.direction,
            money: Money.of(entry.amountMinor, entry.currency),
          }),
      ),
    });
    this.transactions.set(transactionId, transaction);

    return {
      transactionId,
      created: true,
    };
  }

  public async reverseTransaction(input: {
    tenantId: string;
    transactionId: string;
    reference: string;
    description?: string;
  }): Promise<{ transactionId: string; created: boolean }> {
    return { transactionId: `${input.transactionId}-reversal`, created: true };
  }

  public async correctTransaction(input: {
    tenantId: string;
    transactionId: string;
    reversalReference: string;
    correctedReference: string;
    description?: string;
    entries: Array<{
      accountId: string;
      direction: EntryDirection;
      amountMinor: bigint;
      currency: string;
    }>;
  }): Promise<{ reversalTransactionId: string; correctedTransactionId: string; created: boolean }> {
    return {
      reversalTransactionId: `${input.transactionId}-reversal`,
      correctedTransactionId: `${input.transactionId}-corrected`,
      created: true,
    };
  }

  public async createHold(): Promise<{
    holdId: string;
    created: boolean;
    state: 'HELD' | 'APPLIED' | 'VOIDED';
    remainingAmountMinor: bigint;
  }> {
    return { holdId: 'hold-1', created: true, state: 'HELD', remainingAmountMinor: 100n };
  }

  public async commitHold(): Promise<{
    holdId: string;
    state: 'HELD' | 'APPLIED';
    remainingAmountMinor: bigint;
    transactionId: string;
    created: boolean;
  }> {
    return {
      holdId: 'hold-1',
      state: 'APPLIED',
      remainingAmountMinor: 0n,
      transactionId: 'tx-commit-1',
      created: true,
    };
  }

  public async voidHold(): Promise<{
    holdId: string;
    state: 'VOIDED';
    remainingAmountMinor: bigint;
    voided: boolean;
  }> {
    return { holdId: 'hold-1', state: 'VOIDED', remainingAmountMinor: 0n, voided: true };
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
      overdraftPolicy: 'ALLOW',
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

  public async findTransactionByIdForTenant(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null> {
    const transaction = this.transactions.get(transactionId);
    return transaction && transaction.tenantId === tenantId ? transaction : null;
  }

  public async listTransactions(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    const data = [...this.transactions.values()].filter((transaction) => {
      if (transaction.tenantId !== query.tenantId) {
        return false;
      }

      if (query.ledgerId !== undefined && transaction.ledgerId.value !== query.ledgerId) {
        return false;
      }

      return true;
    });

    return { data, nextCursor: null };
  }

  public async listEntries(_query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    return { data: [], nextCursor: null };
  }

  public async getLedgerTrialBalance(_query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
    return {
      ledgerId: 'ledger-1',
      accounts: [],
      totalDebitsMinor: 0n,
      totalCreditsMinor: 0n,
    };
  }

  public async getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    this.getBalanceAtCalls.push(query);
    return {
      tenantId: query.tenantId,
      accountId: query.accountId,
      at: query.at,
      postedMinor: 0n,
      inflightDebitMinor: 0n,
      inflightCreditMinor: 0n,
      availableMinor: 0n,
    };
  }

  public async listBalanceHistory(
    query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
    this.listBalanceHistoryCalls.push(query);
    return { data: [], nextCursor: null };
  }

  public async ingestExternalRecords(
    input: IngestExternalRecordsInput,
  ): Promise<ReconciliationExternalUpload> {
    return {
      id: 'upload-1',
      tenantId: input.tenantId,
      source: input.source,
      recordCount: input.records.length,
      createdAt: new Date(),
    };
  }

  public async createReconciliationMatchingRule(
    input: CreateReconciliationMatchingRuleInput,
  ): Promise<ReconciliationMatchingRule> {
    return {
      id: 'rule-1',
      tenantId: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      criteria: input.criteria,
      createdAt: new Date(),
    };
  }

  public async listReconciliationMatchingRules(): Promise<ReconciliationMatchingRule[]> {
    return [];
  }

  public async getReconciliationMatchingRule(): Promise<ReconciliationMatchingRule | null> {
    return null;
  }

  public async runReconciliation(input: RunReconciliationInput): Promise<ReconciliationRun> {
    const now = new Date();
    return {
      id: 'run-1',
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      uploadId: input.uploadId,
      strategy: input.strategy,
      status: 'completed',
      dryRun: input.dryRun ?? false,
      matchedCount: 0,
      unmatchedExternalCount: 0,
      unmatchedInternalCount: 0,
      mismatchedCount: 0,
      conflictCount: 0,
      startedAt: now,
      completedAt: now,
      results: [],
    };
  }

  public async getReconciliationRun(): Promise<ReconciliationRun | null> {
    return null;
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
      description: 'Service-level description',
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
    expect(repository.createTransactionCalls[0]?.description).toBe('Service-level description');
  });

  it('createTransaction validates description when provided', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.createTransaction({
        tenantId: 'tenant-1',
        ledgerId: 'ledger-1',
        reference: 'ref-1',
        currency: 'USD',
        description: '   ',
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
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
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
      overdraftPolicy: 'ALLOW',
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
        overdraftPolicy: 'ALLOW',
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
        overdraftPolicy: 'ALLOW',
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
      overdraftPolicy: 'ALLOW',
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
      overdraftPolicy: 'ALLOW',
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
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
    });
    await service.createAccount({
      tenantId: 'tenant-1',
      ledgerId: otherLedger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      overdraftPolicy: 'ALLOW',
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

  it('getTransactionById returns transaction for tenant', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Main',
    });

    const created = await service.createTransaction({
      tenantId: 'tenant-1',
      ledgerId: ledger.id,
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

    const found = await service.getTransactionById('tenant-1', created.transactionId);
    expect(found.id.value).toBe(created.transactionId);
  });

  it('getTransactionById throws TransactionNotFoundError for missing/cross-tenant transaction', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const ledger = await service.createLedger({
      tenantId: 'tenant-a',
      name: 'Main',
    });

    const created = await service.createTransaction({
      tenantId: 'tenant-a',
      ledgerId: ledger.id,
      reference: 'ref-1',
      currency: 'USD',
      entries: [
        {
          accountId: 'account-1',
          direction: EntryDirection.DEBIT,
          amountMinor: 50n,
          currency: 'USD',
        },
        {
          accountId: 'account-2',
          direction: EntryDirection.CREDIT,
          amountMinor: 50n,
          currency: 'USD',
        },
      ],
    });

    await expect(
      service.getTransactionById('tenant-b', created.transactionId),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
    await expect(service.getTransactionById('tenant-a', 'missing')).rejects.toBeInstanceOf(
      TransactionNotFoundError,
    );
  });

  it('listTransactions supports tenant-scoped ledger filter', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const mainLedger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Main',
    });
    const secondaryLedger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Secondary',
    });

    await service.createTransaction({
      tenantId: 'tenant-1',
      ledgerId: mainLedger.id,
      reference: 'main-ref',
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
    await service.createTransaction({
      tenantId: 'tenant-1',
      ledgerId: secondaryLedger.id,
      reference: 'secondary-ref',
      currency: 'USD',
      entries: [
        {
          accountId: 'account-3',
          direction: EntryDirection.DEBIT,
          amountMinor: 200n,
          currency: 'USD',
        },
        {
          accountId: 'account-4',
          direction: EntryDirection.CREDIT,
          amountMinor: 200n,
          currency: 'USD',
        },
      ],
    });

    const filtered = await service.listTransactions({
      tenantId: 'tenant-1',
      limit: 50,
      ledgerId: mainLedger.id,
    });

    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0]?.reference).toBe('main-ref');
  });

  it('listTransactions validates ledgerId when provided', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.listTransactions({
        tenantId: 'tenant-1',
        limit: 10,
        ledgerId: '   ',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('commitHold validates required holdId and reference', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.commitHold({
        tenantId: 'tenant-1',
        holdId: ' ',
        reference: 'ref-1',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    await expect(
      service.commitHold({
        tenantId: 'tenant-1',
        holdId: 'hold-1',
        reference: ' ',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('commitHold rejects non-positive explicit amount', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.commitHold({
        tenantId: 'tenant-1',
        holdId: 'hold-1',
        reference: 'ref-1',
        amountMinor: 0n,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('getBalanceAt delegates to repository and preserves timestamp', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const at = new Date('2026-01-01T00:00:00.000Z');

    const result = await service.getBalanceAt({
      tenantId: 'tenant-1',
      accountId: 'account-1',
      at,
    });

    expect(result.accountId).toBe('account-1');
    expect(repository.getBalanceAtCalls).toHaveLength(1);
    expect(repository.getBalanceAtCalls[0]?.at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('getBalanceAt validates timestamp and required fields', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.getBalanceAt({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        at: new Date('not-a-date'),
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    await expect(
      service.getBalanceAt({
        tenantId: 'tenant-1',
        accountId: ' ',
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('listBalanceHistory delegates with pagination args', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-02T00:00:00.000Z');

    await service.listBalanceHistory({
      tenantId: 'tenant-1',
      accountId: 'account-1',
      from,
      to,
      limit: 25,
      cursor: 'cursor-1',
    });

    expect(repository.listBalanceHistoryCalls).toHaveLength(1);
    expect(repository.listBalanceHistoryCalls[0]?.limit).toBe(25);
    expect(repository.listBalanceHistoryCalls[0]?.cursor).toBe('cursor-1');
  });

  it('listBalanceHistory validates dates and range', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.listBalanceHistory({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        from: new Date('not-a-date'),
        to: new Date('2026-01-02T00:00:00.000Z'),
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    await expect(
      service.listBalanceHistory({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        from: new Date('2026-01-03T00:00:00.000Z'),
        to: new Date('2026-01-02T00:00:00.000Z'),
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('listBalanceHistory validates pagination limits', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.listBalanceHistory({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-01-02T00:00:00.000Z'),
        limit: 0,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('createReconciliationMatchingRule rejects unsupported numeric operators', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(
      service.createReconciliationMatchingRule({
        tenantId: 'tenant-1',
        name: 'Invalid amount rule',
        criteria: [{ field: 'amount', operator: 'contains' }],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
