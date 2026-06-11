import {
  AccountService,
  ApiKeyService,
  type ApplicationServices,
  BalanceService,
  HoldService,
  LedgerService,
  ReconciliationService,
  TransactionService,
} from '@lux/ledger/application';
import { DrizzleAccountRepository } from './repositories/account-repository';
import { DrizzleApiKeyRepository } from './repositories/api-key-repository';
import { DrizzleBalanceRepository } from './repositories/balance-repository';
import { DrizzleHoldRepository } from './repositories/hold-repository';
import { DrizzleLedgerRepository } from './repositories/ledger-repository';
import { DrizzleReconciliationRepository } from './repositories/reconciliation-repository';
import { DrizzleTransactionRepository } from './repositories/transaction-repository';
import type { DrizzleRepositoryContext } from './repository-context';

export const createAccountService = (context: DrizzleRepositoryContext): AccountService =>
  new AccountService(new DrizzleAccountRepository(context));

export const createApiKeyService = (context: DrizzleRepositoryContext): ApiKeyService =>
  new ApiKeyService(new DrizzleApiKeyRepository(context));

export const createBalanceService = (context: DrizzleRepositoryContext): BalanceService =>
  new BalanceService(new DrizzleBalanceRepository(context));

export const createHoldService = (context: DrizzleRepositoryContext): HoldService =>
  new HoldService(new DrizzleHoldRepository(context));

export const createLedgerService = (context: DrizzleRepositoryContext): LedgerService =>
  new LedgerService(new DrizzleLedgerRepository(context));

export const createReconciliationService = (
  context: DrizzleRepositoryContext,
): ReconciliationService => new ReconciliationService(new DrizzleReconciliationRepository(context));

export const createTransactionService = (context: DrizzleRepositoryContext): TransactionService =>
  new TransactionService(new DrizzleTransactionRepository(context));

export const createApplicationServices = (
  context: DrizzleRepositoryContext,
): ApplicationServices => ({
  accounts: createAccountService(context),
  apiKeys: createApiKeyService(context),
  balances: createBalanceService(context),
  holds: createHoldService(context),
  ledgers: createLedgerService(context),
  reconciliation: createReconciliationService(context),
  transactions: createTransactionService(context),
});
