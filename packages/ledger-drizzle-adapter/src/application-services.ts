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
import type { DrizzleDatabase } from './database-operation';
import { DrizzleAccountRepository } from './repositories/account-repository';
import { DrizzleApiKeyRepository } from './repositories/api-key-repository';
import { DrizzleBalanceRepository } from './repositories/balance-repository';
import { DrizzleHoldRepository } from './repositories/hold-repository';
import { DrizzleLedgerRepository } from './repositories/ledger-repository';
import { DrizzleReconciliationRepository } from './repositories/reconciliation-repository';
import { DrizzleTransactionRepository } from './repositories/transaction-repository';
import type { RepositoryLogger } from './repository-logger';

export const createAccountService = (db: DrizzleDatabase): AccountService =>
  new AccountService(new DrizzleAccountRepository(db));

export const createApiKeyService = (db: DrizzleDatabase): ApiKeyService =>
  new ApiKeyService(new DrizzleApiKeyRepository(db));

export const createBalanceService = (db: DrizzleDatabase): BalanceService =>
  new BalanceService(new DrizzleBalanceRepository(db));

export const createHoldService = (db: DrizzleDatabase): HoldService =>
  new HoldService(new DrizzleHoldRepository(db));

export const createLedgerService = (db: DrizzleDatabase): LedgerService =>
  new LedgerService(new DrizzleLedgerRepository(db));

export const createReconciliationService = (db: DrizzleDatabase): ReconciliationService =>
  new ReconciliationService(new DrizzleReconciliationRepository(db));

export const createTransactionService = (
  db: DrizzleDatabase,
  logger: RepositoryLogger,
): TransactionService => new TransactionService(new DrizzleTransactionRepository(db, logger));

export const createApplicationServices = (
  db: DrizzleDatabase,
  logger: RepositoryLogger,
): ApplicationServices => ({
  accounts: createAccountService(db),
  apiKeys: createApiKeyService(db),
  balances: createBalanceService(db),
  holds: createHoldService(db),
  ledgers: createLedgerService(db),
  reconciliation: createReconciliationService(db),
  transactions: createTransactionService(db, logger),
});
