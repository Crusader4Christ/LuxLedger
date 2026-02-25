import { registerLedgerRoutes } from '@api/routes/ledgers';
import { registerListingRoutes } from '@api/routes/listings';
import type { LedgerService } from '@core/ledger-service';
import type { LedgerReadService } from '@core/read-service';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface BuildServerOptions {
  ledgerService: LedgerService;
  readService: LedgerReadService;
  logger?: FastifyServerOptions['logger'];
}

const isValidationError = (error: unknown): error is { validation: unknown; message: string } =>
  typeof error === 'object' &&
  error !== null &&
  'validation' in error &&
  'message' in error &&
  typeof (error as { message: unknown }).message === 'string';

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
    readService: options.readService,
  });
  registerListingRoutes(server, {
    readService: options.readService,
  });

  server.setErrorHandler((error, request, reply) => {
    if (isValidationError(error)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: error.message,
      });
    }

    request.log.error({ err: error }, 'Unhandled route error');

    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  return server;
};
