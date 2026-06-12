import { describe, expect, it } from 'bun:test';
import {
  type AccountEntity,
  AccountSide,
  EntryDirection,
  type EntryEntity,
  type TransactionEntity,
} from '@lux/ledger';
import {
  type AccountPaginationQuery,
  AccountService,
  type BalanceAtQuery,
  type BalanceHistoryQuery,
  BalanceService,
  type BalanceSnapshotEvent,
  type CommitHoldInput,
  type CorrectTransactionInput,
  type CreateAccountInput,
  type CreateHoldInput,
  type CreateLedgerInput,
  type CreateReconRuleInput,
  type CreateTransactionInput,
  type CreateTransactionResult,
  type HistoricalBalance,
  HoldService,
  type IngestReconRecordsInput,
  type Ledger,
  LedgerService,
  type LedgerTrialBalanceQuery,
  type PaginatedResult,
  type PaginationQuery,
  ReconciliationService,
  type ReconRule,
  type ReconRun,
  type ReconUpload,
  type ReverseTransactionInput,
  type RunReconInput,
  type TransactionPaginationQuery,
  TransactionService,
  type TrialBalance,
  type VoidHoldInput,
} from '@lux/ledger/application';

class InMemoryLedgerRepository {
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

  public async findLedger(tenantId: string, id: string): Promise<Ledger | null> {
    const ledger = this.ledgers.get(id);
    return ledger && ledger.tenantId === tenantId ? ledger : null;
  }

  public async listLedgers(tenantId: string): Promise<Ledger[]> {
    return [...this.ledgers.values()].filter((ledger) => ledger.tenantId === tenantId);
  }

  public async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    this.transactions.push(input);
    return {
      transactionId: `tx-${this.transactions.length}`,
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

  public async reverseTransaction(_input: ReverseTransactionInput): Promise<{
    transactionId: string;
    created: boolean;
  }> {
    return { transactionId: 'tx-reversal-1', created: true };
  }

  public async correctTransaction(_input: CorrectTransactionInput): Promise<{
    reversalTransactionId: string;
    correctedTransactionId: string;
    created: boolean;
  }> {
    return {
      reversalTransactionId: 'tx-reversal-1',
      correctedTransactionId: 'tx-corrected-1',
      created: true,
    };
  }

  public async createHold(_input: CreateHoldInput): Promise<{
    holdId: string;
    created: boolean;
    state: 'HELD' | 'APPLIED' | 'VOIDED';
    remainingAmountMinor: bigint;
  }> {
    return { holdId: 'hold-1', created: true, state: 'HELD', remainingAmountMinor: 100n };
  }

  public async commitHold(_input: CommitHoldInput): Promise<{
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

  public async voidHold(_input: VoidHoldInput): Promise<{
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
      throw new Error(`Ledger not found: ${input.ledgerId}`);
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
    _query: AccountPaginationQuery,
  ): Promise<PaginatedResult<AccountEntity>> {
    return { data: [], nextCursor: null };
  }

  public async listTransactions(
    _query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    return { data: [], nextCursor: null };
  }

  public async findTransaction(
    _tenantId: string,
    _transactionId: string,
  ): Promise<TransactionEntity | null> {
    return null;
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
    _query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
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

  public async listReconciliationMatchingRules(_tenantId: string): Promise<ReconRule[]> {
    return [];
  }

  public async getReconciliationMatchingRule(
    _tenantId: string,
    _ruleId: string,
  ): Promise<ReconRule | null> {
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

  public async getReconciliationRun(_tenantId: string, _runId: string): Promise<ReconRun | null> {
    return null;
  }
}

const createServices = (repository: InMemoryLedgerRepository) => ({
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

describe('application services integration (services + in-memory repository)', () => {
  it('keeps tenant boundaries and delegates transaction creation', async () => {
    const repository = new InMemoryLedgerRepository();
    const services = createServices(repository);

    const tenantALedger = await services.ledgers.create({
      tenantId: 'tenant-a',
      name: 'Main A',
    });
    await services.ledgers.create({
      tenantId: 'tenant-b',
      name: 'Main B',
    });

    const tenantALedgers = await services.ledgers.list('tenant-a');
    expect(tenantALedgers.length).toBe(1);
    expect(tenantALedgers[0]?.id).toBe(tenantALedger.id);

    const txResult = await services.transactions.create({
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
    const services = createServices(repository);
    const ledger = await services.ledgers.create({
      tenantId: 'tenant-a',
      name: 'Main A',
    });

    const created = await services.accounts.create({
      tenantId: 'tenant-a',
      ledgerId: ledger.id,
      name: 'Cash',
      side: AccountSide.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
    });
    const found = await services.accounts.getById('tenant-a', created.id);

    expect(found.id).toBe(created.id);
    expect(found.ledgerId).toBe(ledger.id);
  });
});
