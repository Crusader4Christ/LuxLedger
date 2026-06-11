import type { AccountEntity } from '../account/entity';
import type { ApiKeyEntity } from '../api-key/entity';
import type { CreateApiKeyInput } from '../api-key/input.interface';
import type { EntryEntity } from '../entry/entity';
import type { LedgerEntity } from '../ledger/entity';
import type { ReconRule } from '../reconciliation';
import type { TenantEntity } from '../tenant/entity';
import type { TransactionEntity } from '../transaction/entity';
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
  PaginatedResult,
  PaginationQuery,
  ReconRun,
  ReconUpload,
  ReverseTransactionInput,
  ReverseTransactionResult,
  RunReconInput,
  TransactionPaginationQuery,
  TrialBalance,
  VoidHoldInput,
  VoidHoldResult,
} from './types';

export interface LedgerRepository {
  create(input: CreateLedgerInput): Promise<LedgerEntity>;
  findById(tenantId: string, ledgerId: string): Promise<LedgerEntity | null>;
  list(tenantId: string): Promise<LedgerEntity[]>;
}

export interface ApiKeyRepository {
  count(): Promise<number>;
  createTenant(input: { name: string }): Promise<TenantEntity>;
  findActiveByHash(keyHash: string): Promise<ApiKeyEntity | null>;
  findById(apiKeyId: string): Promise<ApiKeyEntity | null>;
  create(input: CreateApiKeyInput): Promise<ApiKeyEntity>;
  list(tenantId: string): Promise<ApiKeyEntity[]>;
  revoke(tenantId: string, apiKeyId: string): Promise<boolean>;
}

export interface AccountRepository {
  create(input: CreateAccountInput): Promise<AccountEntity>;
  findById(tenantId: string, accountId: string): Promise<AccountEntity | null>;
  list(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>>;
}

export interface TransactionApplicationRepository {
  create(input: CreateTransactionInput): Promise<CreateTransactionResult>;
  createBulk(input: BulkCreateTransactionInput): Promise<BulkCreateTransactionResult>;
  reverse(input: ReverseTransactionInput): Promise<ReverseTransactionResult>;
  correct(input: CorrectTransactionInput): Promise<CorrectTransactionResult>;
  findById(tenantId: string, transactionId: string): Promise<TransactionEntity | null>;
  list(query: TransactionPaginationQuery): Promise<PaginatedResult<TransactionEntity>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>>;
}

export interface HoldApplicationRepository {
  create(input: CreateHoldInput): Promise<CreateHoldResult>;
  commit(input: CommitHoldInput): Promise<CommitHoldResult>;
  void(input: VoidHoldInput): Promise<VoidHoldResult>;
}

export interface BalanceApplicationRepository {
  getTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance>;
  getAt(query: BalanceAtQuery): Promise<HistoricalBalance>;
  listHistory(query: BalanceHistoryQuery): Promise<PaginatedResult<BalanceSnapshotEvent>>;
}

export interface ReconciliationApplicationRepository {
  ingest(input: IngestReconRecordsInput): Promise<ReconUpload>;
  createRule(input: CreateReconRuleInput): Promise<ReconRule>;
  listRules(tenantId: string): Promise<ReconRule[]>;
  getRule(tenantId: string, ruleId: string): Promise<ReconRule | null>;
  run(input: RunReconInput): Promise<ReconRun>;
  getRun(tenantId: string, runId: string): Promise<ReconRun | null>;
}

// Compatibility contract for callers that still use the combined repository API.
export interface LegacyCombinedLedgerRepository {
  createLedger(input: CreateLedgerInput): Promise<LedgerEntity>;
  findLedger(tenantId: string, ledgerId: string): Promise<LedgerEntity | null>;
  listLedgers(tenantId: string): Promise<LedgerEntity[]>;
  createAccount(input: CreateAccountInput): Promise<AccountEntity>;
  findAccount(tenantId: string, accountId: string): Promise<AccountEntity | null>;
  listAccounts(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>>;
  createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult>;
  createTransactionsBulk(input: BulkCreateTransactionInput): Promise<BulkCreateTransactionResult>;
  reverseTransaction(input: ReverseTransactionInput): Promise<ReverseTransactionResult>;
  correctTransaction(input: CorrectTransactionInput): Promise<CorrectTransactionResult>;
  findTransaction(tenantId: string, transactionId: string): Promise<TransactionEntity | null>;
  listTransactions(query: TransactionPaginationQuery): Promise<PaginatedResult<TransactionEntity>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>>;
  createHold(input: CreateHoldInput): Promise<CreateHoldResult>;
  commitHold(input: CommitHoldInput): Promise<CommitHoldResult>;
  voidHold(input: VoidHoldInput): Promise<VoidHoldResult>;
  getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance>;
  getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance>;
  listBalanceHistory(query: BalanceHistoryQuery): Promise<PaginatedResult<BalanceSnapshotEvent>>;
  ingestExternalRecords(input: IngestReconRecordsInput): Promise<ReconUpload>;
  createReconciliationMatchingRule(input: CreateReconRuleInput): Promise<ReconRule>;
  listReconciliationMatchingRules(tenantId: string): Promise<ReconRule[]>;
  getReconciliationMatchingRule(tenantId: string, ruleId: string): Promise<ReconRule | null>;
  runReconciliation(input: RunReconInput): Promise<ReconRun>;
  getReconciliationRun(tenantId: string, runId: string): Promise<ReconRun | null>;
}
