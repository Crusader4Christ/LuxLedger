export interface Tenant {
  id: string;
  name: string;
  createdAt: Date;
}

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
