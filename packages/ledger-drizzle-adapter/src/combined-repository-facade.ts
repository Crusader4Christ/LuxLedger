import type { AccountEntity, EntryEntity, LedgerEntity, TransactionEntity } from '@lux/ledger';
import type {
  AccountPaginationQuery,
  BalanceAtQuery,
  BalanceHistoryQuery,
  BalanceSnapshotEvent,
  BulkCreateTransactionInput,
  BulkCreateTransactionResult,
  CommitHoldInput,
  CommitHoldResult,
  CorrectTransactionInput,
  CorrectTransactionResult,
  CreateAccountInput,
  CreateHoldInput,
  CreateHoldResult,
  CreateLedgerInput,
  CreateReconRuleInput,
  CreateTransactionInput,
  CreateTransactionResult,
  HistoricalBalance,
  IngestReconRecordsInput,
  LedgerTrialBalanceQuery,
  LegacyCombinedLedgerRepository,
  PaginatedResult,
  PaginationQuery,
  ReconRule,
  ReconRun,
  ReconUpload,
  ReverseTransactionInput,
  ReverseTransactionResult,
  RunReconInput,
  TransactionPaginationQuery,
  TrialBalance,
  VoidHoldInput,
  VoidHoldResult,
} from '@lux/ledger/application';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAccountRepository } from './repositories/account-repository';
import { DrizzleBalanceRepository } from './repositories/balance-repository';
import { DrizzleHoldRepository } from './repositories/hold-repository';
import { DrizzleLedgerRepository } from './repositories/ledger-repository';
import { DrizzleReconciliationRepository } from './repositories/reconciliation-repository';
import { DrizzleTenantRepository } from './repositories/tenant-repository';
import { DrizzleTransactionRepository } from './repositories/transaction-repository';
import type { RepositoryLogger } from './repository-logger';
import type * as schema from './schema';

export class CombinedDrizzleRepositoryFacade implements LegacyCombinedLedgerRepository {
  private readonly accounts: DrizzleAccountRepository;
  private readonly balances: DrizzleBalanceRepository;
  private readonly holds: DrizzleHoldRepository;
  private readonly ledgers: DrizzleLedgerRepository;
  private readonly reconciliation: DrizzleReconciliationRepository;
  private readonly tenants: DrizzleTenantRepository;
  private readonly transactions: DrizzleTransactionRepository;

  public constructor(db: PostgresJsDatabase<typeof schema>, logger: RepositoryLogger) {
    this.accounts = new DrizzleAccountRepository(db);
    this.balances = new DrizzleBalanceRepository(db);
    this.holds = new DrizzleHoldRepository(db);
    this.ledgers = new DrizzleLedgerRepository(db);
    this.reconciliation = new DrizzleReconciliationRepository(db);
    this.tenants = new DrizzleTenantRepository(db);
    this.transactions = new DrizzleTransactionRepository(db, logger);
  }

  public createTenant(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    return this.tenants.create(input);
  }

  public createLedger(input: CreateLedgerInput): Promise<LedgerEntity> {
    return this.ledgers.create(input);
  }

  public findLedger(tenantId: string, ledgerId: string): Promise<LedgerEntity | null> {
    return this.ledgers.findById(tenantId, ledgerId);
  }

  public listLedgers(tenantId: string): Promise<LedgerEntity[]> {
    return this.ledgers.list(tenantId);
  }

  public createAccount(input: CreateAccountInput): Promise<AccountEntity> {
    return this.accounts.create(input);
  }

  public findAccount(tenantId: string, accountId: string): Promise<AccountEntity | null> {
    return this.accounts.findById(tenantId, accountId);
  }

  public listAccounts(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>> {
    return this.accounts.list(query);
  }

  public createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    return this.transactions.create(input);
  }

  public createTransactionsBulk(
    input: BulkCreateTransactionInput,
  ): Promise<BulkCreateTransactionResult> {
    return this.transactions.createBulk(input);
  }

  public reverseTransaction(input: ReverseTransactionInput): Promise<ReverseTransactionResult> {
    return this.transactions.reverse(input);
  }

  public correctTransaction(input: CorrectTransactionInput): Promise<CorrectTransactionResult> {
    return this.transactions.correct(input);
  }

  public findTransaction(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null> {
    return this.transactions.findById(tenantId, transactionId);
  }

  public listTransactions(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    return this.transactions.list(query);
  }

  public listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    return this.transactions.listEntries(query);
  }

  public createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
    return this.holds.create(input);
  }

  public commitHold(input: CommitHoldInput): Promise<CommitHoldResult> {
    return this.holds.commit(input);
  }

  public voidHold(input: VoidHoldInput): Promise<VoidHoldResult> {
    return this.holds.void(input);
  }

  public getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
    return this.balances.getTrialBalance(query);
  }

  public getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    return this.balances.getAt(query);
  }

  public listBalanceHistory(
    query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
    return this.balances.listHistory(query);
  }

  public ingestExternalRecords(input: IngestReconRecordsInput): Promise<ReconUpload> {
    return this.reconciliation.ingest(input);
  }

  public createReconciliationMatchingRule(input: CreateReconRuleInput): Promise<ReconRule> {
    return this.reconciliation.createRule(input);
  }

  public listReconciliationMatchingRules(tenantId: string): Promise<ReconRule[]> {
    return this.reconciliation.listRules(tenantId);
  }

  public getReconciliationMatchingRule(
    tenantId: string,
    ruleId: string,
  ): Promise<ReconRule | null> {
    return this.reconciliation.getRule(tenantId, ruleId);
  }

  public runReconciliation(input: RunReconInput): Promise<ReconRun> {
    return this.reconciliation.run(input);
  }

  public getReconciliationRun(tenantId: string, runId: string): Promise<ReconRun | null> {
    return this.reconciliation.getRun(tenantId, runId);
  }
}
