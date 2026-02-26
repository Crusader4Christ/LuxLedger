import '@api/fastify-extensions';
import { randomUUID } from 'node:crypto';
import { sendDomainError } from '@api/errors';
import { registerAdminApiKeyRoutes } from '@api/routes/admin-api-keys';
import { registerLedgerRoutes } from '@api/routes/ledgers';
import { registerListingRoutes } from '@api/routes/listings';
import type { ApiKeyService } from '@core/api-key-service';
import { ForbiddenError, UnauthorizedError } from '@core/errors';
import type { LedgerService } from '@core/ledger-service';
import type { LedgerReadService } from '@core/read-service';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface BuildServerOptions {
  apiKeyService: ApiKeyService;
  ledgerService: LedgerService;
  readService: LedgerReadService;
  readinessCheck: () => Promise<void>;
  logger?: FastifyServerOptions['logger'];
}

const API_KEY_HEADER = 'x-api-key';
const BEARER_PREFIX = 'Bearer ';

const isValidationError = (error: unknown): error is { validation: unknown; message: string } =>
  typeof error === 'object' &&
  error !== null &&
  'validation' in error &&
  'message' in error &&
  typeof (error as { message: unknown }).message === 'string';

export const buildServer = (options: BuildServerOptions): FastifyInstance => {
  const server = Fastify({
    logger: options.logger ?? true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: (request) => {
      const headerValue = request.headers['x-request-id'];
      if (typeof headerValue === 'string' && headerValue.length > 0) {
        return headerValue;
      }

      return randomUUID();
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  server.decorateRequest('tenantId');
  server.decorateRequest('apiKeyId');
  server.decorateRequest('apiKeyRole');

  server.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);

    if (!request.url.startsWith('/v1/')) {
      return;
    }

    const apiKeyHeader = request.headers[API_KEY_HEADER];
    const authorizationHeader = request.headers.authorization;
    const bearerToken =
      typeof authorizationHeader === 'string' && authorizationHeader.startsWith(BEARER_PREFIX)
        ? authorizationHeader.slice(BEARER_PREFIX.length).trim()
        : null;
    const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : bearerToken;

    if (!apiKey) {
      throw new UnauthorizedError('API key is required');
    }

    const auth = await options.apiKeyService.authenticate(apiKey);
    request.tenantId = auth.tenantId;
    request.apiKeyId = auth.apiKeyId;
    request.apiKeyRole = auth.role;

    if (request.url.startsWith('/v1/admin/') && auth.role !== 'ADMIN') {
      throw new ForbiddenError('Admin API key is required');
    }
  });

  server.get('/health', async () => {
    return { ok: true };
  });

  server.get('/ready', async (request, reply) => {
    try {
      await options.readinessCheck();
      return reply.status(200).send({ ok: true });
    } catch (error) {
      request.log.error({ err: error }, 'Readiness check failed');
      return reply.status(503).send({
        error: 'NOT_READY',
        message: 'Service not ready',
      });
    }
  });

  registerLedgerRoutes(server, {
    ledgerService: options.ledgerService,
    readService: options.readService,
  });
  registerListingRoutes(server, {
    readService: options.readService,
  });
  registerAdminApiKeyRoutes(server, {
    apiKeyService: options.apiKeyService,
  });

  server.setErrorHandler((error, request, reply) => {
    try {
      return sendDomainError(reply, error);
    } catch {
      // Continue with generic error handling below.
    }

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
