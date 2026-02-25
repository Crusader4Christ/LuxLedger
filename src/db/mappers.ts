import type {
  AccountListItem,
  EntryListItem,
  Ledger,
  Tenant,
  TransactionListItem,
} from '@core/types';
import type { accounts, entries, ledgers, tenants, transactions } from '@db/schema';

type TenantRow = typeof tenants.$inferSelect;
type LedgerRow = typeof ledgers.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;
type EntryRow = typeof entries.$inferSelect;

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
  direction: row.direction as 'DEBIT' | 'CREDIT',
  amountMinor: row.amountMinor,
  currency: row.currency,
  createdAt: row.createdAt,
});
