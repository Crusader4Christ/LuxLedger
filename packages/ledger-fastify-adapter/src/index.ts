import { AccountsRoutes } from './routes/accounts';
import { AdminApiKeyRoutes } from './routes/admin-api-keys';
import { EntriesListRoute } from './routes/entries';
import { LedgerRoutes } from './routes/ledgers';
import { TransactionsRoutes } from './routes/transactions';
import type { ApiKeyService, LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export type FastifyLedgerAdapterDependencies = {
  ledgerService: LedgerService;
  apiKeyService: ApiKeyService;
};

export const registerLedgerFastifyAdapter = (
  server: FastifyInstance,
  dependencies: FastifyLedgerAdapterDependencies,
): void => {
  new LedgerRoutes(dependencies.ledgerService).register(server);
  new AccountsRoutes(dependencies.ledgerService).register(server);
  new TransactionsRoutes(dependencies.ledgerService).register(server);
  new EntriesListRoute(dependencies.ledgerService).register(server);
  new AdminApiKeyRoutes(dependencies.apiKeyService).register(server);
};
