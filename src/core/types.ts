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
