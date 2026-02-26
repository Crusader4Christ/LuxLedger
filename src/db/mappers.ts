import { InvariantViolationError } from '@core/errors';
import type {
  AccountListItem,
  ApiKeyListItem,
  EntryListItem,
  Ledger,
  Tenant,
  TransactionListItem,
} from '@core/types';
import type { accounts, apiKeys, entries, ledgers, tenants, transactions } from '@db/schema';

type TenantRow = typeof tenants.$inferSelect;
type LedgerRow = typeof ledgers.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;
type EntryRow = typeof entries.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;

const toDirection = (value: string): 'DEBIT' | 'CREDIT' => {
  if (value === 'DEBIT' || value === 'CREDIT') {
    return value;
  }

  throw new InvariantViolationError(`Invalid entry direction: ${value}`);
};

export const toTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
});

export const toLedger = (row: LedgerRow): Ledger => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toAccountListItem = (row: AccountRow): AccountListItem => ({
  id: row.id,
  tenantId: row.tenantId,
  ledgerId: row.ledgerId,
  name: row.name,
  currency: row.currency,
  balanceMinor: row.balanceMinor,
  createdAt: row.createdAt,
});

export const toTransactionListItem = (row: TransactionRow): TransactionListItem => ({
  id: row.id,
  tenantId: row.tenantId,
  ledgerId: row.ledgerId,
  reference: row.reference,
  currency: row.currency,
  createdAt: row.createdAt,
});

export const toEntryListItem = (row: EntryRow): EntryListItem => ({
  id: row.id,
  transactionId: row.transactionId,
  accountId: row.accountId,
  direction: toDirection(row.direction),
  amountMinor: row.amountMinor,
  currency: row.currency,
  createdAt: row.createdAt,
});

export const toApiKeyListItem = (row: ApiKeyRow): ApiKeyListItem => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  role: row.role === 'ADMIN' ? 'ADMIN' : 'SERVICE',
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
});
