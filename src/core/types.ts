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

export interface LedgerRepository {
  createLedger(input: CreateLedgerInput): Promise<Ledger>;
  findLedgerById(id: string): Promise<Ledger | null>;
  findLedgersByTenant(tenantId: string): Promise<Ledger[]>;
}
