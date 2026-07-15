import type { ApplicationServices } from '@lux/ledger/application';
import express, { type Application } from 'express';
import { registerAccountRoutes } from './routes/accounts';
import { registerAdminApiKeyRoutes } from './routes/admin-api-keys';
import { registerEntryRoutes } from './routes/entries';
import { registerHoldRoutes } from './routes/holds';
import { registerLedgerRoutes } from './routes/ledgers';
import { registerReconciliationRoutes } from './routes/reconciliation';
import { registerTransactionRoutes } from './routes/transactions';

export type { RequestContext, RequestWithContext } from './types';

const ensureJsonMiddleware = (app: Application): void => {
  const stack = (app as Application & { _router?: { stack?: unknown[] } })._router?.stack;
  if (!Array.isArray(stack) || stack.length === 0) {
    app.use(express.json());
  }
};

export const registerLedgerAdapter = (app: Application, services: ApplicationServices): void => {
  ensureJsonMiddleware(app);

  registerLedgerRoutes(app, services);
  registerTransactionRoutes(app, services);
  registerAccountRoutes(app, services);
  registerHoldRoutes(app, services);
  registerReconciliationRoutes(app, services);
  registerEntryRoutes(app, services);
  registerAdminApiKeyRoutes(app, services);
};

export const registerLedgerExpressAdapter = registerLedgerAdapter;
