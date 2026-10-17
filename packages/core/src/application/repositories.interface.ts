import type { AccountEntity } from '../account/entity';
import type { ApiKeyEntity } from '../api-key/entity';
import type { CreateApiKeyInput } from '../api-key/input.interface';
import type { EntryEntity } from '../entry/entity';
import type { LedgerEntity } from '../ledger/entity';
import type { ReconRule } from '../reconciliation';
import type { TransactionEntity } from '../transaction/entity';
import type {
  AccountPaginationQuery,
  AdjustmentDirection,
  AdjustmentResult,
  Asset,
  BalanceAtQuery,
  BalanceHistoryQuery,
  BalanceSnapshotEvent,
  BootstrapAdminRepositoryInput,
  BootstrapAdminResult,
  BulkCreateTransactionInput,
  BulkCreateTransactionResult,
  CommitHoldInput,
  CommitHoldResult,
  CorrectTransactionInput,
  CorrectTransactionResult,
  CreateAccountInput,
  CreateAdjustmentInput,
  CreateAssetInput,
  CreateCreditGrantInput,
  CreateHoldInput,
  CreateHoldResult,
  CreateLedgerInput,
  CreateReconRuleInput,
  CreateTransactionInput,
  CreateTransactionResult,
  CreditBalance,
  CreditGrant,
  CreditGrantExpirationResult,
  CreditGrantLineage,
  CreditGrantListQuery,
  CreditGrantLotBalance,
  CreditGrantRefundResult,
  CreditGrantResult,
  CreditLineageQuery,
  CreditLotListQuery,
  HistoricalBalance,
  IngestReconRecordsInput,
  LedgerTrialBalanceQuery,
  PaginatedResult,
  PaginationQuery,
  ProcessCreditGrantExpirationsInput,
  ReconRun,
  ReconUpload,
  RefundCreditGrantInput,
  ReverseCreditGrantInput,
  ReverseTransactionInput,
  ReverseTransactionResult,
  RunReconInput,
  TransactionPaginationQuery,
  TrialBalance,
  VoidHoldInput,
  VoidHoldResult,
} from './types';

export interface AdjustmentRepository {
  create(direction: AdjustmentDirection, input: CreateAdjustmentInput): Promise<AdjustmentResult>;
}

export interface CreditGrantRepository {
  create(input: CreateCreditGrantInput): Promise<CreditGrantResult>;
  /** Reverses only the specified grant when its own remaining capacity equals its original amount. */
  reverse(input: ReverseCreditGrantInput): Promise<CreditGrantResult>;
  /** Removes only current unspent, unreserved, and unexpired capacity from one grant. */
  refund(input: RefundCreditGrantInput): Promise<CreditGrantRefundResult>;
  findById(tenantId: string, grantId: string): Promise<CreditGrant | null>;
  getBalance(tenantId: string, accountId: string): Promise<CreditBalance>;
  list(query: CreditGrantListQuery): Promise<PaginatedResult<CreditGrant>>;
  listLots(query: CreditLotListQuery): Promise<PaginatedResult<CreditGrantLotBalance>>;
  listLineage(query: CreditLineageQuery): Promise<PaginatedResult<CreditGrantLineage>>;
  previewExpirations(
    input: ProcessCreditGrantExpirationsInput,
  ): Promise<CreditGrantExpirationResult>;
  runExpirations(input: ProcessCreditGrantExpirationsInput): Promise<CreditGrantExpirationResult>;
}

export interface AssetRepository {
  create(input: CreateAssetInput): Promise<Asset>;
  findById(tenantId: string, assetId: string): Promise<Asset | null>;
  list(tenantId: string): Promise<Asset[]>;
}

export interface LedgerRepository {
  create(input: CreateLedgerInput): Promise<LedgerEntity>;
  findById(tenantId: string, ledgerId: string): Promise<LedgerEntity | null>;
  list(tenantId: string): Promise<LedgerEntity[]>;
}

export interface ApiKeyRepository {
  bootstrapInitialAdmin(input: BootstrapAdminRepositoryInput): Promise<BootstrapAdminResult>;
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
