import type { ApiKeyService, LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';
import { AccountsRoutes } from './routes/accounts';
import { AdminApiKeyRoutes } from './routes/admin-api-keys';
import { EntriesListRoute } from './routes/entries';
import { HoldsRoutes } from './routes/holds';
import { LedgerRoutes } from './routes/ledgers';
import { ReconciliationRoutes } from './routes/reconciliation';
import { TransactionsRoutes } from './routes/transactions';

export type FastifyLedgerAdapterDependencies = {
  ledgerService: LedgerService;
  apiKeyService: ApiKeyService;
};

export const registerLedgerAdapter = (
  server: FastifyInstance,
  dependencies: FastifyLedgerAdapterDependencies,
): void => {
  new LedgerRoutes(dependencies.ledgerService).register(server);
  new AccountsRoutes(dependencies.ledgerService).register(server);
  new TransactionsRoutes(dependencies.ledgerService).register(server);
  new HoldsRoutes(dependencies.ledgerService).register(server);
  new EntriesListRoute(dependencies.ledgerService).register(server);
  new ReconciliationRoutes(dependencies.ledgerService).register(server);
  new AdminApiKeyRoutes(dependencies.apiKeyService).register(server);
};

export const registerLedgerFastifyAdapter = registerLedgerAdapter;
