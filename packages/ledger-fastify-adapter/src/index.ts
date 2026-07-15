import './fastify-extensions';
import type { ApplicationServices } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';
import { AccountsRoutes } from './routes/accounts';
import { AdminApiKeyRoutes } from './routes/admin-api-keys';
import { EntriesListRoute } from './routes/entries';
import { HoldsRoutes } from './routes/holds';
import { LedgerRoutes } from './routes/ledgers';
import { ReconRoutes } from './routes/reconciliation';
import { TransactionsRoutes } from './routes/transactions';

export const registerLedgerAdapter = (
  server: FastifyInstance,
  services: ApplicationServices,
): void => {
  new LedgerRoutes(services.ledgers, services.transactions, services.balances).register(server);
  new AccountsRoutes(services.accounts, services.balances).register(server);
  new TransactionsRoutes(services.transactions).register(server);
  new HoldsRoutes(services.holds).register(server);
  new EntriesListRoute(services.transactions).register(server);
  new ReconRoutes(services.reconciliation).register(server);
  new AdminApiKeyRoutes(services.apiKeys).register(server);
};

export const registerLedgerFastifyAdapter = registerLedgerAdapter;
