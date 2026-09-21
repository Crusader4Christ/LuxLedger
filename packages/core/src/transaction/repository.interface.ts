import type { AccountId, LedgerId } from '../base/id';

export interface TransactionAccountSnapshot {
  id: AccountId;
  ledgerId: LedgerId;
  currency: string;
  assetId?: string | null;
}

export interface TransactionRepository {
  findAccounts(tenantId: string, accountIds: AccountId[]): Promise<TransactionAccountSnapshot[]>;
}
