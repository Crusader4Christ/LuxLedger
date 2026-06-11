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
  AccountService,
  type BalanceAtQuery,
  type BalanceHistoryQuery,
  BalanceService,
  type BalanceSnapshotEvent,
  BulkTransactionError,
  type CreateAccountInput,
  type CreateLedgerInput,
  type CreateReconRuleInput,
  type CreateTransactionInput,
  type CreateTransactionResult,
  EntryDirection,
  type HistoricalBalance,
  HoldService,
  type IngestReconRecordsInput,
  InvariantViolationError,
  type Ledger,
  LedgerNotFoundError,
  LedgerService,
  type LedgerTrialBalanceQuery,
  type LegacyCombinedLedgerRepository,
  type PaginatedResult,
  type PaginationQuery,
  ReconciliationService,
  type ReconRule,
  type ReconRun,
  type ReconUpload,
  type RunReconInput,
  TransactionNotFoundError,
  type TransactionPaginationQuery,
  TransactionService,
  type TrialBalance,
} from '@lux/ledger/application';

class InMemoryLedgerRepository implements LegacyCombinedLedgerRepository {
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

  public async findLedger(tenantId: string, id: string): Promise<Ledger | null> {
    const ledger = this.ledgers.get(id);
    return ledger && ledger.tenantId === tenantId ? ledger : null;
  }

  public async listLedgers(tenantId: string): Promise<Ledger[]> {
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

  public async createTransactionsBulk(input: {
    tenantId: string;
    transactions: CreateTransactionInput[];
  }) {
    const transactions = [];
    for (const transaction of input.transactions) {
      const result = await this.createTransaction(transaction);
      transactions.push({
        reference: transaction.reference,
        transactionId: result.transactionId,
        created: result.created,
      });
    }
    return {
      createdCount: transactions.filter((transaction) => transaction.created).length,
      idempotentCount: transactions.filter((transaction) => !transaction.created).length,
      transactions,
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

  public async findAccount(tenantId: string, accountId: string): Promise<AccountEntity | null> {
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

  public async findTransaction(
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

  public async ingestExternalRecords(input: IngestReconRecordsInput): Promise<ReconUpload> {
    return {
      id: 'upload-1',
      tenantId: input.tenantId,
      source: input.source,
      recordCount: input.records.length,
      createdAt: new Date(),
    };
  }

  public async createReconciliationMatchingRule(input: CreateReconRuleInput): Promise<ReconRule> {
    return {
      id: 'rule-1',
      tenantId: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      criteria: input.criteria,
      createdAt: new Date(),
    };
  }

  public async listReconciliationMatchingRules(): Promise<ReconRule[]> {
    return [];
  }

  public async getReconciliationMatchingRule(): Promise<ReconRule | null> {
    return null;
  }

  public async runReconciliation(input: RunReconInput): Promise<ReconRun> {
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

  public async getReconciliationRun(): Promise<ReconRun | null> {
    return null;
  }
}

const createServices = (repository: LegacyCombinedLedgerRepository) => ({
  accounts: new AccountService({
    create: (input) => repository.createAccount(input),
    findById: (tenantId, accountId) => repository.findAccount(tenantId, accountId),
    list: (query) => repository.listAccounts(query),
  }),
  balances: new BalanceService({
    getTrialBalance: (query) => repository.getLedgerTrialBalance(query),
    getAt: (query) => repository.getBalanceAt(query),
    listHistory: (query) => repository.listBalanceHistory(query),
  }),
  holds: new HoldService({
    create: (input) => repository.createHold(input),
    commit: (input) => repository.commitHold(input),
    void: (input) => repository.voidHold(input),
  }),
  ledgers: new LedgerService({
    create: (input) => repository.createLedger(input),
    findById: (tenantId, ledgerId) => repository.findLedger(tenantId, ledgerId),
    list: (tenantId) => repository.listLedgers(tenantId),
  }),
  reconciliation: new ReconciliationService({
    ingest: (input) => repository.ingestExternalRecords(input),
    createRule: (input) => repository.createReconciliationMatchingRule(input),
    listRules: (tenantId) => repository.listReconciliationMatchingRules(tenantId),
    getRule: (tenantId, ruleId) => repository.getReconciliationMatchingRule(tenantId, ruleId),
    run: (input) => repository.runReconciliation(input),
    getRun: (tenantId, runId) => repository.getReconciliationRun(tenantId, runId),
  }),
  transactions: new TransactionService({
    create: (input) => repository.createTransaction(input),
    createBulk: (input) => repository.createTransactionsBulk(input),
    reverse: (input) => repository.reverseTransaction(input),
    correct: (input) => repository.correctTransaction(input),
    findById: (tenantId, transactionId) => repository.findTransaction(tenantId, transactionId),
    list: (query) => repository.listTransactions(query),
    listEntries: (query) => repository.listEntries(query),
  }),
});

describe('application services', () => {
  it('createLedger returns entity', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    const ledger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Cash',
    });

    expect(ledger.id).toBe('ledger-1');
    expect(ledger.tenantId).toBe('tenant-1');
    expect(ledger.name).toBe('Cash');
  });

  it('createLedger throws InvariantViolationError for empty tenantId', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(services.ledgers.create({ tenantId: '  ', name: 'Cash' })).rejects.toBeInstanceOf(
      InvariantViolationError,
    );
  });

  it('getLedgerById returns correct ledger', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    const created = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Cash',
    });

    const found = await services.ledgers.getById('tenant-1', created.id);

    expect(found.id).toBe(created.id);
    expect(found.tenantId).toBe('tenant-1');
  });

  it('getLedgerById throws LedgerNotFoundError if not found', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(services.ledgers.getById('tenant-1', 'missing-ledger')).rejects.toBeInstanceOf(
      LedgerNotFoundError,
    );
  });

  it('getLedgerById throws LedgerNotFoundError for another tenant ledger', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    const created = await services.ledgers.create({
      tenantId: 'tenant-a',
      name: 'Cash',
    });

    await expect(services.ledgers.getById('tenant-b', created.id)).rejects.toBeInstanceOf(
      LedgerNotFoundError,
    );
  });

  it('listLedgers throws InvariantViolationError for empty tenantId', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(services.ledgers.list('')).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('createTransaction delegates to repository', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    const result = await services.transactions.create({
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

  it('createTransaction delegates effectiveAt to repository', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const effectiveAt = new Date('2024-01-15T10:00:00.000Z');

    await services.transactions.create({
      tenantId: 'tenant-1',
      ledgerId: 'ledger-1',
      reference: 'ref-effective',
      currency: 'USD',
      effectiveAt,
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

    expect(repository.createTransactionCalls[0]?.effectiveAt).toBe(effectiveAt);
  });

  it('createTransactionsBulk rejects duplicate references before repository write', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const transaction = {
      tenantId: 'tenant-1',
      ledgerId: 'ledger-1',
      reference: 'bulk-dup',
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
    };

    const error = await services.transactions
      .createBulk({
        tenantId: 'tenant-1',
        transactions: [transaction, transaction],
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkTransactionError);
    expect((error as BulkTransactionError).details).toEqual({
      item_index: 1,
      reference: 'bulk-dup',
      category: 'VALIDATION',
    });
    expect(repository.createTransactionCalls).toHaveLength(0);
  });

  it('createTransaction validates description when provided', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(
      services.transactions.create({
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
    const services = createServices(repository);

    await expect(
      services.transactions.create({
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
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Main',
    });

    const account = await services.accounts.create({
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
    const services = createServices(repository);
    const tenantALedger = await services.ledgers.create({
      tenantId: 'tenant-a',
      name: 'Main A',
    });

    await expect(
      services.accounts.create({
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
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Main',
    });

    await expect(
      services.accounts.create({
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
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Main',
    });
    const created = await services.accounts.create({
      tenantId: 'tenant-1',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
    });

    const found = await services.accounts.getById('tenant-1', created.id);
    expect(found.id).toBe(created.id);
  });

  it('getAccountById throws AccountNotFoundError for missing/cross-tenant account', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-a',
      name: 'Main',
    });
    const created = await services.accounts.create({
      tenantId: 'tenant-a',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
    });

    await expect(services.accounts.getById('tenant-b', created.id)).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  it('listAccounts supports tenant-scoped ledger filter', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const tenantLedger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Main',
    });
    const otherLedger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Secondary',
    });
    await services.accounts.create({
      tenantId: 'tenant-1',
      ledgerId: tenantLedger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
    });
    await services.accounts.create({
      tenantId: 'tenant-1',
      ledgerId: otherLedger.id,
      name: 'Revenue',
      side: AccountSide.CREDIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
    });

    const filtered = await services.accounts.list({
      tenantId: 'tenant-1',
      limit: 50,
      ledgerId: tenantLedger.id,
    });

    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0]?.name).toBe('Cash');
  });

  it('getTransactionById returns transaction for tenant', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Main',
    });

    const created = await services.transactions.create({
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

    const found = await services.transactions.getById('tenant-1', created.transactionId);
    expect(found.id.value).toBe(created.transactionId);
  });

  it('getTransactionById throws TransactionNotFoundError for missing/cross-tenant transaction', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-a',
      name: 'Main',
    });

    const created = await services.transactions.create({
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
      services.transactions.getById('tenant-b', created.transactionId),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
    await expect(services.transactions.getById('tenant-a', 'missing')).rejects.toBeInstanceOf(
      TransactionNotFoundError,
    );
  });

  it('listTransactions supports tenant-scoped ledger filter', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const mainLedger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Main',
    });
    const secondaryLedger = await services.ledgers.create({
      tenantId: 'tenant-1',
      name: 'Secondary',
    });

    await services.transactions.create({
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
    await services.transactions.create({
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

    const filtered = await services.transactions.list({
      tenantId: 'tenant-1',
      limit: 50,
      ledgerId: mainLedger.id,
    });

    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0]?.reference).toBe('main-ref');
  });

  it('listTransactions validates ledgerId when provided', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(
      services.transactions.list({
        tenantId: 'tenant-1',
        limit: 10,
        ledgerId: '   ',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('commitHold validates required holdId and reference', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(
      services.holds.commit({
        tenantId: 'tenant-1',
        holdId: ' ',
        reference: 'ref-1',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    await expect(
      services.holds.commit({
        tenantId: 'tenant-1',
        holdId: 'hold-1',
        reference: ' ',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('commitHold rejects non-positive explicit amount', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    await expect(
      services.holds.commit({
        tenantId: 'tenant-1',
        holdId: 'hold-1',
        reference: 'ref-1',
        amountMinor: 0n,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('getBalanceAt delegates to repository and preserves timestamp', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const at = new Date('2026-01-01T00:00:00.000Z');

    const result = await services.balances.getAt({
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
    const services = createServices(repository);

    await expect(
      services.balances.getAt({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        at: new Date('not-a-date'),
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    await expect(
      services.balances.getAt({
        tenantId: 'tenant-1',
        accountId: ' ',
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('listBalanceHistory delegates with pagination args', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-02T00:00:00.000Z');

    await services.balances.listHistory({
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
    const services = createServices(repository);

    await expect(
      services.balances.listHistory({
        tenantId: 'tenant-1',
        accountId: 'account-1',
        from: new Date('not-a-date'),
        to: new Date('2026-01-02T00:00:00.000Z'),
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    await expect(
      services.balances.listHistory({
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
    const services = createServices(repository);

    await expect(
      services.balances.listHistory({
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
    const services = createServices(repository);

    await expect(
      services.reconciliation.createRule({
        tenantId: 'tenant-1',
        name: 'Invalid amount rule',
        criteria: [{ field: 'amount', operator: 'contains' }],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
