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
import type { DbClient } from './client';
import { DrizzleAccountRepository } from './repositories/account-repository';
import { DrizzleApiKeyRepository } from './repositories/api-key-repository';
import { DrizzleBalanceRepository } from './repositories/balance-repository';
import { DrizzleHoldRepository } from './repositories/hold-repository';
import { DrizzleLedgerRepository } from './repositories/ledger-repository';
import { DrizzleReconciliationRepository } from './repositories/reconciliation-repository';
import { DrizzleTransactionRepository } from './repositories/transaction-repository';
import type { RepositoryLogger } from './repository-logger';

export const createAccountService = (client: DbClient): AccountService =>
  new AccountService(new DrizzleAccountRepository(client));

export const createApiKeyService = (client: DbClient): ApiKeyService =>
  new ApiKeyService(new DrizzleApiKeyRepository(client));

export const createBalanceService = (client: DbClient): BalanceService =>
  new BalanceService(new DrizzleBalanceRepository(client));

export const createHoldService = (client: DbClient): HoldService =>
  new HoldService(new DrizzleHoldRepository(client));

export const createLedgerService = (client: DbClient): LedgerService =>
  new LedgerService(new DrizzleLedgerRepository(client));

export const createReconciliationService = (client: DbClient): ReconciliationService =>
  new ReconciliationService(new DrizzleReconciliationRepository(client));

export const createTransactionService = (
  client: DbClient,
  logger: RepositoryLogger,
): TransactionService => new TransactionService(new DrizzleTransactionRepository(client, logger));

export const createApplicationServices = (
  client: DbClient,
  logger: RepositoryLogger,
): ApplicationServices => ({
  accounts: createAccountService(client),
  apiKeys: createApiKeyService(client),
  balances: createBalanceService(client),
  holds: createHoldService(client),
  ledgers: createLedgerService(client),
  reconciliation: createReconciliationService(client),
  transactions: createTransactionService(client, logger),
});
