import type { AccountService } from './account-service';
import type { ApiKeyService } from './api-key-service';
import type { AssetService } from './asset-service';
import type { BalanceService } from './balance-service';
import type { CreditGrantService } from './credit-grant-service';
import type { HoldService } from './hold-service';
import type { LedgerService } from './ledger-service';
import type { ReconciliationService } from './reconciliation-service';
import type { TransactionService } from './transaction-service';

export interface ApplicationServices {
  accounts: AccountService;
  assets: AssetService;
  apiKeys: ApiKeyService;
  balances: BalanceService;
  creditGrants: CreditGrantService;
  holds: HoldService;
  ledgers: LedgerService;
  reconciliation: ReconciliationService;
  transactions: TransactionService;
}
