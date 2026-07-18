import type { AccountId, LedgerId } from '../base/id';

export interface TransactionAccountSnapshot {
  id: AccountId;
  ledgerId: LedgerId;
  currency: string;
}

export interface TransactionRepository {
  findAccounts(tenantId: string, accountIds: AccountId[]): Promise<TransactionAccountSnapshot[]>;
}
