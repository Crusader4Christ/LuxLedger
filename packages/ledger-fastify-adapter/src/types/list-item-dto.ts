export type AccountListItemDto = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  name: string;
  side: string;
  overdraft_policy: 'ALLOW' | 'DISALLOW';
  currency: string;
  balance_minor: string;
  created_at: string;
};
