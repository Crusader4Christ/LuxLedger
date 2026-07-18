import type { AccountService } from './account-service';
import type { ApiKeyService } from './api-key-service';
import type { BalanceService } from './balance-service';
import type { HoldService } from './hold-service';
import type { LedgerService } from './ledger-service';
import type { ReconciliationService } from './reconciliation-service';
import type { TransactionService } from './transaction-service';

export interface ApplicationServices {
  accounts: AccountService;
  apiKeys: ApiKeyService;
  balances: BalanceService;
  holds: HoldService;
  ledgers: LedgerService;
  reconciliation: ReconciliationService;
  transactions: TransactionService;
}
