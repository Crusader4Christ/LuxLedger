import type { AccountEntity, AccountSide } from '../account/entity';
import type { ApiKeyEntity, ApiKeyRole } from '../api-key/entity';
import type { CreateApiKeyInput as PersistApiKeyInput } from '../api-key/input.interface';
import type { EntryDirection, EntryEntity } from '../entry/entity';
import type { TransactionEntryInput } from '../entry/input.interface';
import type { CreateLedgerInput } from '../ledger/input.interface';
import type { LedgerRepository as BaseLedgerRepository } from '../ledger/repository.interface';
import type { TenantEntity } from '../tenant/entity';
import type { CreateTenantInput } from '../tenant/input.interface';
import type { TransactionEntity } from '../transaction/entity';
import type { CreateTransactionCommand } from '../transaction/use-cases/create-transaction.command';

export type Tenant = TenantEntity;
export type { AccountSide, ApiKeyRole, CreateLedgerInput, EntryDirection };
export type Ledger = Awaited<ReturnType<BaseLedgerRepository['createLedger']>>;

export type EntryInput = TransactionEntryInput;

export type CreateTransactionInput = Omit<CreateTransactionCommand, 'id'>;

export interface CreateTransactionResult {
  transactionId: string;
  created: boolean;
}

export interface PaginationQuery {
  tenantId: string;
  limit: number;
  cursor?: string;
}

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
}

export interface TrialBalance {
  ledgerId: string;
  accounts: TrialBalanceAccount[];
  totalDebitsMinor: bigint;
  totalCreditsMinor: bigint;
}

export interface TrialBalanceQuery {
  tenantId: string;
  ledgerId: string;
}

export interface AuthContext {
  apiKeyId: string;
  tenantId: string;
  role: ApiKeyRole;
}

export type CreateApiKeyInput = Omit<PersistApiKeyInput, 'keyHash'>;

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
  createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult>;
  listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountEntity>>;
  listTransactions(query: PaginationQuery): Promise<PaginatedResult<TransactionEntity>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>>;
  getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance>;
}

export interface ApiKeyRepository {
  countApiKeys(): Promise<number>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null>;
  createApiKey(input: PersistApiKeyInput): Promise<ApiKeyEntity>;
  listApiKeys(tenantId: string): Promise<ApiKeyEntity[]>;
  revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean>;
}
