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

export interface LedgerRepository {
  createLedger(input: CreateLedgerInput): Promise<Ledger>;
  findLedgerById(id: string): Promise<Ledger | null>;
  findLedgersByTenant(tenantId: string): Promise<Ledger[]>;
  postTransaction(input: PostTransactionInput): Promise<PostTransactionResult>;
}
