import type { Ledger, Tenant } from '@core/types';
import type { ledgers, tenants } from '@db/schema';

type TenantRow = typeof tenants.$inferSelect;
type LedgerRow = typeof ledgers.$inferSelect;

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
