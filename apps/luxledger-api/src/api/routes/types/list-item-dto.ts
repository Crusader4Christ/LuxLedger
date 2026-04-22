export type AccountListItemDto = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  name: string;
  side: string;
  currency: string;
  balance_minor: string;
  created_at: string;
};

export type TransactionListItemDto = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  reference: string;
  currency: string;
  created_at: string;
};

export type EntryListItemDto = {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: string;
  amount_minor: string;
  currency: string;
  created_at: string;
};
