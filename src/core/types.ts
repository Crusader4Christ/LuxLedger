export interface Tenant {
  id: string;
  name: string;
  createdAt: Date;
}

export type ApiKeyRole = 'ADMIN' | 'SERVICE';

export interface Ledger {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLedgerInput {
  tenantId: string;
  name: string;
}

export interface PostingEntryInput {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
  currency: string;
}

export interface PostTransactionInput {
  tenantId: string;
  ledgerId: string;
  reference: string;
  currency: string;
  entries: PostingEntryInput[];
}

export interface PostTransactionResult {
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

export interface AccountListItem {
  id: string;
  tenantId: string;
  ledgerId: string;
  name: string;
  currency: string;
  balanceMinor: bigint;
  createdAt: Date;
}

export interface TransactionListItem {
  id: string;
  tenantId: string;
  ledgerId: string;
  reference: string;
  currency: string;
  createdAt: Date;
}

export interface EntryListItem {
  id: string;
  transactionId: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
}

export interface TrialBalanceAccount {
  accountId: string;
  code: string;
  name: string;
  normalBalance: 'DEBIT' | 'CREDIT';
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

export interface StoredApiKey {
  id: string;
  tenantId: string;
  role: ApiKeyRole;
  keyHash: string;
  revokedAt: Date | null;
}

export interface ApiKeyListItem {
  id: string;
  tenantId: string;
  name: string;
  role: ApiKeyRole;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface CreateApiKeyInput {
  tenantId: string;
  name: string;
  role: ApiKeyRole;
}

export interface CreateApiKeyResult {
  apiKey: string;
  key: ApiKeyListItem;
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

export interface LedgerRepository {
  createLedger(input: CreateLedgerInput): Promise<Ledger>;
  findLedgerByIdForTenant(tenantId: string, id: string): Promise<Ledger | null>;
  findLedgersByTenant(tenantId: string): Promise<Ledger[]>;
  postTransaction(input: PostTransactionInput): Promise<PostTransactionResult>;
}

export interface LedgerReadRepository {
  listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountListItem>>;
  listTransactions(query: PaginationQuery): Promise<PaginatedResult<TransactionListItem>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryListItem>>;
  getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance>;
}

export interface ApiKeyRepository {
  countApiKeys(): Promise<number>;
  createTenant(input: { name: string }): Promise<Tenant>;
  findActiveApiKeyByHash(keyHash: string): Promise<StoredApiKey | null>;
  createApiKey(input: {
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
  }): Promise<ApiKeyListItem>;
  listApiKeys(tenantId: string): Promise<ApiKeyListItem[]>;
  revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean>;
}
