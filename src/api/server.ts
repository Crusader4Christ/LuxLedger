import { registerLedgerRoutes } from '@api/routes/ledgers';
import type { LedgerService } from '@core/ledger-service';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface BuildServerOptions {
  ledgerService: LedgerService;
  logger?: FastifyServerOptions['logger'];
}

export const buildServer = (options: BuildServerOptions): FastifyInstance => {
  const server = Fastify({
    logger: options.logger ?? true,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  server.get('/health', async () => {
    return { ok: true };
  });

  registerLedgerRoutes(server, {
    ledgerService: options.ledgerService,
  });

  return server;
};
