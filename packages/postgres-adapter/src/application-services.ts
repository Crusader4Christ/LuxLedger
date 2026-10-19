import {
  AccountService,
  AdjustmentService,
  ApiKeyService,
  type ApplicationServices,
  AssetService,
  BalanceService,
  CreditGrantService,
  HoldService,
  LedgerService,
  ReconciliationService,
  StatementService,
  TransactionService,
} from '@luxledger/core/application';
import type { DbClient } from './client';
import { DrizzleAccountRepository } from './repositories/account-repository';
import { DrizzleAdjustmentRepository } from './repositories/adjustment-repository';
import { DrizzleApiKeyRepository } from './repositories/api-key-repository';
import { DrizzleAssetRepository } from './repositories/asset-repository';
import { DrizzleBalanceRepository } from './repositories/balance-repository';
import { DrizzleCreditGrantRepository } from './repositories/credit-grant-repository';
import { DrizzleHoldRepository } from './repositories/hold-repository';
import { DrizzleLedgerRepository } from './repositories/ledger-repository';
import { DrizzleReconciliationRepository } from './repositories/reconciliation-repository';
import { DrizzleStatementRepository } from './repositories/statement-repository';
import { DrizzleTransactionRepository } from './repositories/transaction-repository';

export const createAccountService = (client: DbClient): AccountService =>
  new AccountService(new DrizzleAccountRepository(client));

export const createAdjustmentService = (client: DbClient): AdjustmentService =>
  new AdjustmentService(new DrizzleAdjustmentRepository(client));

export const createAssetService = (client: DbClient): AssetService =>
  new AssetService(new DrizzleAssetRepository(client));

export const createApiKeyService = (client: DbClient): ApiKeyService =>
  new ApiKeyService(new DrizzleApiKeyRepository(client));

export const createBalanceService = (client: DbClient): BalanceService =>
  new BalanceService(new DrizzleBalanceRepository(client));

export const createCreditGrantService = (client: DbClient): CreditGrantService =>
  new CreditGrantService(new DrizzleCreditGrantRepository(client));

export const createHoldService = (client: DbClient): HoldService =>
  new HoldService(new DrizzleHoldRepository(client));

export const createLedgerService = (client: DbClient): LedgerService =>
  new LedgerService(new DrizzleLedgerRepository(client));

export const createReconciliationService = (client: DbClient): ReconciliationService =>
  new ReconciliationService(new DrizzleReconciliationRepository(client));

export const createStatementService = (client: DbClient): StatementService =>
  new StatementService(new DrizzleStatementRepository(client));

export const createTransactionService = (client: DbClient): TransactionService =>
  new TransactionService(new DrizzleTransactionRepository(client));

export const createApplicationServices = (client: DbClient): ApplicationServices => ({
  accounts: createAccountService(client),
  adjustments: createAdjustmentService(client),
  assets: createAssetService(client),
  apiKeys: createApiKeyService(client),
  balances: createBalanceService(client),
  creditGrants: createCreditGrantService(client),
  holds: createHoldService(client),
  ledgers: createLedgerService(client),
  reconciliation: createReconciliationService(client),
  statements: createStatementService(client),
  transactions: createTransactionService(client),
});
