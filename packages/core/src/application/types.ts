import type { AccountSide, OverdraftPolicy } from '../account/entity';
import type { CreateAccountInput } from '../account/input.interface';
import type { accountListFilter } from '../account/list-filter';
import type { ApiKeyEntity, ApiKeyRole } from '../api-key/entity';
import type { CreateApiKeyInput } from '../api-key/input.interface';
import type { JsonObject } from '../base/json';
import type { UnknownRecord } from '../base/object';
import type { LedgerEntity } from '../ledger/entity';
import type { CreateLedgerInput } from '../ledger/input.interface';
import type {
  ReconMatchCriterion,
  ReconRecord,
  ReconResultStatus,
  ReconRule,
  ReconRunStatus,
  ReconStrategy,
} from '../reconciliation';
import type { TenantEntity } from '../tenant/entity';
import type { transactionListFilter } from '../transaction/list-filter';
import type { CreateTransactionCommand } from '../transaction/use-cases/create-transaction.command';
import { defineListFilter, type ListFilterPolicy, type WhereFor } from './list-filters';

export type Tenant = TenantEntity;
export interface Asset {
  id: string;
  tenantId: string;
  code: string;
  scale: number;
  createdAt: Date;
}

export const assetListFilter = defineListFilter<Asset>()(['tenantId']);

export interface CreateAssetInput {
  tenantId: string;
  code: string;
  scale: number;
}

export interface CreateCreditGrantInput {
  tenantId: string;
  ledgerId: string;
  accountId: string;
  fundingAccountId: string;
  reference: string;
  externalReference?: string | null;
  amountMinor: bigint;
  expiresAt?: Date | null;
}

export interface CreditGrant {
  id: string;
  tenantId: string;
  ledgerId: string;
  accountId: string;
  fundingAccountId: string;
  assetId: string;
  reference: string;
  externalReference: string | null;
  amountMinor: bigint;
  transactionId: string;
  createdAt: Date;
  expiresAt: Date | null;
  reversedByTransactionId: string | null;
}

export const creditGrantListFilter = defineListFilter<CreditGrant>()([
  'tenantId',
  'assetId',
  'amountMinor',
  'reversedByTransactionId',
]);

export interface CreditGrantResult {
  grant: CreditGrant;
  created: boolean;
}
export interface ReverseCreditGrantInput {
  tenantId: string;
  grantId: string;
  reference: string;
}
export interface RefundCreditGrantInput extends ReverseCreditGrantInput {
  amountMinor: bigint;
}
export interface CreditGrantRefundResult {
  grantId: string;
  transactionId: string;
  amountMinor: bigint;
  created: boolean;
}
export interface CreditGrantLotBalance {
  grantId: string;
  reference: string;
  externalReference: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  grantedMinor: bigint;
  reversedMinor: bigint;
  consumedMinor: bigint;
  compensatedMinor: bigint;
  expiredMinor: bigint;
  remainingMinor: bigint;
}
export interface CreditBalance {
  accountId: string;
  assetId: string;
  ledgerBalanceMinor: bigint;
  remainingMinor: bigint;
}
export interface CreditGrantListQuery extends PaginationQuery<typeof creditGrantListFilter> {
  accountId?: string;
  reference?: string;
  externalReference?: string;
}
export interface CreditLotListQuery extends PaginationQuery<typeof creditGrantListFilter> {
  accountId: string;
}
export interface CreditLineageQuery extends PaginationQuery<typeof creditLineageListFilter> {
  grantId?: string;
  transactionId?: string;
}
export type CreditGrantLineageKind = 'CONSUMPTION' | 'COMPENSATION' | 'EXPIRATION' | 'REFUND';
export interface CreditGrantLineage {
  grantId: string;
  entryId: string;
  transactionId: string;
  kind: CreditGrantLineageKind;
  amountMinor: bigint;
  createdAt: Date;
}

export const creditLineageListFilter = defineListFilter<CreditGrantLineage>()([]);

export interface ProcessCreditGrantExpirationsInput {
  tenantId: string;
  asOf: Date;
  limit: number;
}

export interface CreditGrantExpirationItem {
  grantId: string;
  accountId: string;
  fundingAccountId: string;
  expiresAt: Date;
  amountMinor: bigint;
  cumulativeExpiredMinor: bigint;
  transactionId: string | null;
}

export interface CreditGrantExpirationResult {
  asOf: Date;
  items: CreditGrantExpirationItem[];
}

export type AdjustmentDirection = 'CREDIT' | 'DEBIT';

export interface CreateAdjustmentInput {
  tenantId: string;
  ledgerId: string;
  accountId: string;
  offsetAccountId: string;
  reference: string;
  amountMinor: bigint;
  description: string;
  reasonCode: string;
  actorId: string;
  attributes?: JsonObject;
}

export interface AdjustmentResult {
  transactionId: string;
  created: boolean;
}
export type { AccountSide, ApiKeyRole, CreateLedgerInput, OverdraftPolicy };
export type Ledger = LedgerEntity;

export type CreateTransactionInput = Omit<CreateTransactionCommand, 'id'>;

export interface CreateTransactionResult {
  transactionId: string;
  created: boolean;
}

export interface BulkCreateTransactionInput {
  tenantId: string;
  transactions: CreateTransactionInput[];
}

export interface BulkCreateTransactionItemResult {
  reference: string;
  transactionId: string;
  created: boolean;
}

export interface BulkCreateTransactionResult {
  createdCount: number;
  idempotentCount: number;
  transactions: BulkCreateTransactionItemResult[];
}

export interface ReverseTransactionInput {
  tenantId: string;
  transactionId: string;
  reference: string;
  description?: string;
}

export interface ReverseTransactionResult {
  transactionId: string;
  created: boolean;
}

export interface CorrectTransactionInput {
  tenantId: string;
  transactionId: string;
  reversalReference: string;
  correctedReference: string;
  description?: string;
  entries: HoldEntryInput[];
}

export interface CorrectTransactionResult {
  reversalTransactionId: string;
  correctedTransactionId: string;
  created: boolean;
}

export interface HoldEntryInput {
  accountId: string;
  signedAmountMinor: bigint;
  currency: string;
}

export interface CreateHoldInput {
  tenantId: string;
  ledgerId: string;
  reference: string;
  currency: string;
  description?: string;
  entries: HoldEntryInput[];
}

export interface CreateHoldResult {
  holdId: string;
  created: boolean;
  state: 'HELD' | 'APPLIED' | 'VOIDED';
  remainingAmountMinor: bigint;
}

export interface CommitHoldInput {
  tenantId: string;
  holdId: string;
  reference: string;
  amountMinor?: bigint;
}

export interface CommitHoldResult {
  holdId: string;
  state: 'HELD' | 'APPLIED' | 'VOIDED';
  remainingAmountMinor: bigint;
  transactionId: string;
  created: boolean;
}

export interface VoidHoldInput {
  tenantId: string;
  holdId: string;
}

export interface VoidHoldResult {
  holdId: string;
  state: 'VOIDED';
  remainingAmountMinor: bigint;
  voided: boolean;
}

export interface BasePaginationQuery {
  tenantId: string;
  limit: number;
  cursor?: string;
}

export interface PaginationQuery<Policy extends ListFilterPolicy = never>
  extends BasePaginationQuery {
  where?: WhereFor<Policy>;
}

export interface AccountPaginationQuery extends PaginationQuery<typeof accountListFilter> {
  ledgerId?: string;
}

export interface TransactionPaginationQuery extends PaginationQuery<typeof transactionListFilter> {
  ledgerId?: string;
}

export type { CreateAccountInput };

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

export interface TrialBalanceAccount {
  accountId: string;
  code: string | null;
  name: string;
  normalBalance: AccountSide;
  balanceMinor: bigint;
  balanceSide: AccountSide;
}

export interface TrialBalance {
  ledgerId: string;
  accounts: TrialBalanceAccount[];
  totalDebitsMinor: bigint;
  totalCreditsMinor: bigint;
}

export interface LedgerTrialBalanceQuery {
  tenantId: string;
  ledgerId: string;
}

export interface BalanceAtQuery {
  tenantId: string;
  accountId: string;
  at: Date;
}

export interface HistoricalBalance {
  tenantId: string;
  accountId: string;
  at: Date;
  postedMinor: bigint;
  reservedDeltaMinor: bigint;
  availableMinor: bigint;
}

export interface BalanceSnapshotEvent {
  id: string;
  tenantId: string;
  ledgerId: string;
  accountId: string;
  eventType: 'TX_APPLIED' | 'HOLD_CREATED' | 'HOLD_COMMITTED' | 'HOLD_VOIDED' | 'ADJUSTMENT';
  sourceId: string;
  postedMinor: bigint;
  reservedDeltaMinor: bigint;
  effectiveAt: Date;
  createdAt: Date;
}

export const balanceHistoryListFilter = defineListFilter<BalanceSnapshotEvent>()(['tenantId']);

export interface BalanceHistoryQuery extends PaginationQuery<typeof balanceHistoryListFilter> {
  accountId: string;
  from: Date;
  to: Date;
}

export interface StatementBalance {
  postedMinor: bigint;
  reservedDeltaMinor: bigint;
  availableMinor: bigint;
}

export interface AccountStatementQuery extends PaginationQuery {
  accountId: string;
  from: Date;
  asOf: Date;
}

export interface StatementMovement {
  id: string;
  eventType: BalanceSnapshotEvent['eventType'];
  sourceId: string;
  postedDeltaMinor: bigint;
  reservedDeltaMinor: bigint;
  availableDeltaMinor: bigint;
  effectiveAt: Date;
  createdAt: Date;
}

export interface AccountStatement {
  accountId: string;
  assetId: string;
  from: Date;
  asOf: Date;
  opening: StatementBalance;
  closing: StatementBalance;
  data: StatementMovement[];
  nextCursor: string | null;
}

export const CREDIT_LOT_MOVEMENT_KINDS = [
  'ISSUANCE',
  'REVERSAL',
  'CONSUMPTION',
  'COMPENSATION',
  'EXPIRATION',
  'REFUND',
  'HOLD_RESERVED',
  'HOLD_RELEASED',
] as const;

export type CreditLotMovementKind = (typeof CREDIT_LOT_MOVEMENT_KINDS)[number];

export interface CreditLotStatementQuery extends AccountStatementQuery {
  grantId?: string;
}

export interface CreditLotMovement {
  id: string;
  grantId: string;
  kind: CreditLotMovementKind;
  sourceTransactionId: string | null;
  sourceHoldId: string | null;
  availableDeltaMinor: bigint;
  remainingMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
  effectiveAt: Date;
  createdAt: Date;
}

export interface CreditLotStatement {
  accountId: string;
  assetId: string;
  grantId: string | null;
  from: Date;
  asOf: Date;
  openingAvailableMinor: bigint;
  closingAvailableMinor: bigint;
  data: CreditLotMovement[];
  nextCursor: string | null;
}

export type ReconRecordInput = {
  externalId: string;
  amountMinor: bigint;
  currency: string;
  reference: string;
  description?: string | null;
  occurredAt: Date;
  raw?: UnknownRecord | null;
};

export interface IngestReconRecordsInput {
  tenantId: string;
  source: string;
  records: ReconRecordInput[];
}

export interface ReconUpload {
  id: string;
  tenantId: string;
  source: string;
  recordCount: number;
  createdAt: Date;
}

export interface CreateReconRuleInput {
  tenantId: string;
  name: string;
  description?: string | null;
  criteria: ReconMatchCriterion[];
}

export interface RunReconInput {
  tenantId: string;
  ledgerId: string;
  uploadId: string;
  matchingRuleIds: string[];
  strategy: ReconStrategy;
  dryRun?: boolean;
}

export interface ReconResult {
  id: string;
  runId: string;
  externalRecordId: string | null;
  externalId: string | null;
  transactionId: string | null;
  status: ReconResultStatus;
  reason: string;
  candidateTransactionIds: string[];
  createdAt: Date;
}

export const reconResultListFilter = defineListFilter<ReconResult>()(['candidateTransactionIds']);

export interface ReconResultPaginationQuery extends PaginationQuery<typeof reconResultListFilter> {
  runId: string;
}

export interface ReconRun {
  id: string;
  tenantId: string;
  ledgerId: string;
  uploadId: string;
  strategy: ReconStrategy;
  status: ReconRunStatus;
  dryRun: boolean;
  matchedCount: number;
  unmatchedExternalCount: number;
  unmatchedInternalCount: number;
  mismatchedCount: number;
  conflictCount: number;
  startedAt: Date;
  completedAt: Date | null;
  results: ReconResult[];
}

export interface AuthContext {
  apiKeyId: string;
  tenantId: string;
  role: ApiKeyRole;
}

export type CreateApiKeyRequestInput = Omit<CreateApiKeyInput, 'keyHash'>;

export interface CreateApiKeyResult {
  apiKey: string;
  key: ApiKeyEntity;
}

export interface BootstrapAdminInput {
  tenantName: string;
  keyName: string;
  rawApiKey: string;
}

export interface BootstrapAdminRepositoryInput {
  tenantName: string;
  keyName: string;
  keyHash: string;
}

export interface BootstrapAdminResult {
  created: boolean;
  tenantId?: string;
  apiKeyId?: string;
}

export type {
  ReconMatchCriterion,
  ReconRecord,
  ReconResultStatus,
  ReconRule,
  ReconRunStatus,
  ReconStrategy,
};
