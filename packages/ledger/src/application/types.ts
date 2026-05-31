import type { AccountEntity, AccountSide } from '../account/entity';
import type { CreateAccountInput } from '../account/input.interface';
import type { ApiKeyEntity, ApiKeyRole } from '../api-key/entity';
import type { CreateApiKeyInput } from '../api-key/input.interface';
import type { EntryDirection, EntryEntity } from '../entry/entity';
import type { CreateLedgerInput } from '../ledger/input.interface';
import type { LedgerRepository as BaseLedgerRepository } from '../ledger/repository.interface';
import type { TenantEntity } from '../tenant/entity';
import type { CreateTenantInput } from '../tenant/input.interface';
import type { TransactionEntity } from '../transaction/entity';
import type { CreateTransactionCommand } from '../transaction/use-cases/create-transaction.command';

export type Tenant = TenantEntity;
export type { AccountSide, ApiKeyRole, CreateLedgerInput, EntryDirection };
export type Ledger = Awaited<ReturnType<BaseLedgerRepository['createLedger']>>;

export type CreateTransactionInput = Omit<CreateTransactionCommand, 'id'>;

export interface CreateTransactionResult {
  transactionId: string;
  created: boolean;
}

export interface HoldEntryInput {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
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
  state: 'HELD' | 'APPLIED';
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

export interface PaginationQuery {
  tenantId: string;
  limit: number;
  cursor?: string;
}

export interface AccountPaginationQuery extends PaginationQuery {
  ledgerId?: string;
}

export interface TransactionPaginationQuery extends PaginationQuery {
  ledgerId?: string;
}

export type { CreateAccountInput };

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

export interface TrialBalanceAccount {
  accountId: string;
  code: string;
  name: string;
  normalBalance: AccountSide;
  balanceMinor: bigint;
  isContra: boolean;
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
  inflightDebitMinor: bigint;
  inflightCreditMinor: bigint;
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
  inflightDebitMinor: bigint;
  inflightCreditMinor: bigint;
  effectiveAt: Date;
  createdAt: Date;
}

export interface BalanceHistoryQuery {
  tenantId: string;
  accountId: string;
  from: Date;
  to: Date;
  limit: number;
  cursor?: string;
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

export interface BootstrapAdminResult {
  created: boolean;
  tenantId?: string;
  apiKeyId?: string;
}

export interface LedgerRepository extends BaseLedgerRepository {
  createAccount(input: CreateAccountInput): Promise<AccountEntity>;
  findAccountByIdForTenant(tenantId: string, accountId: string): Promise<AccountEntity | null>;
  findTransactionByIdForTenant(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null>;
  createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult>;
  createHold(input: CreateHoldInput): Promise<CreateHoldResult>;
  commitHold(input: CommitHoldInput): Promise<CommitHoldResult>;
  voidHold(input: VoidHoldInput): Promise<VoidHoldResult>;
  listAccounts(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>>;
  listTransactions(query: TransactionPaginationQuery): Promise<PaginatedResult<TransactionEntity>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>>;
  getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance>;
  getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance>;
  listBalanceHistory(query: BalanceHistoryQuery): Promise<PaginatedResult<BalanceSnapshotEvent>>;
}

export interface ApiKeyRepository {
  countApiKeys(): Promise<number>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null>;
  findApiKeyById(apiKeyId: string): Promise<ApiKeyEntity | null>;
  createApiKey(input: CreateApiKeyInput): Promise<ApiKeyEntity>;
  listApiKeys(tenantId: string): Promise<ApiKeyEntity[]>;
  revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean>;
}
