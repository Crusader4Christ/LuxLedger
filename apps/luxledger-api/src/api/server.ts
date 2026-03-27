import '@api/fastify-extensions';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sendDomainError } from '@api/errors';
import { issueAccessToken, verifyAccessToken } from '@api/jwt-auth';
import { registerAdminApiKeyRoutes } from '@api/routes/admin-api-keys';
import { registerLedgerRoutes } from '@api/routes/ledgers';
import { registerListingRoutes } from '@api/routes/listings';
import type { ApplicationDependencies, CreateServerCoreOptions } from '@api/server-types';
import { ApiKeyRole } from '@lux/ledger';
import { ForbiddenError, UnauthorizedError } from '@services/errors';
import Fastify, { type FastifyInstance } from 'fastify';

const API_KEY_HEADER = 'x-api-key';
const BEARER_PREFIX = 'Bearer ';
const TOKEN_ENDPOINT = '/v1/auth/token';
const OPENAPI_SPEC_PATH = fileURLToPath(new URL('../../openapi/openapi.yaml', import.meta.url));
const OPENAPI_SPEC_CONTENT = readFileSync(OPENAPI_SPEC_PATH, 'utf8');
const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LuxLedger API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        defaultModelsExpandDepth: 1,
        docExpansion: 'list'
      });
    </script>
  </body>
</html>
`;

const isValidationError = (error: unknown): error is { validation: unknown; message: string } =>
  typeof error === 'object' &&
  error !== null &&
  'validation' in error &&
  'message' in error &&
  typeof (error as { message: unknown }).message === 'string';

export const createServerCore = (options: CreateServerCoreOptions): FastifyInstance => {
  const server = Fastify({
    logger: options.logger,
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

  server.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
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

  server.get('/openapi.yaml', async (_request, reply) => {
    return reply
      .header('content-type', 'application/yaml; charset=utf-8')
      .status(200)
      .send(OPENAPI_SPEC_CONTENT);
  });

  server.get('/docs', async (_request, reply) => {
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .status(200)
      .send(SWAGGER_UI_HTML);
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

export const registerApplication = (
  server: FastifyInstance,
  dependencies: ApplicationDependencies,
): void => {
  server.decorateRequest('tenantId');
  server.decorateRequest('apiKeyId');
  server.decorateRequest('apiKeyRole');

  server.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/v1/')) {
      return;
    }

    if (request.url === TOKEN_ENDPOINT) {
      const apiKeyHeader = request.headers[API_KEY_HEADER];
      if (typeof apiKeyHeader !== 'string') {
        throw new UnauthorizedError('API key is required');
      }

      const auth = await dependencies.apiKeyService.authenticate(apiKeyHeader);
      request.tenantId = auth.tenantId;
      request.apiKeyId = auth.apiKeyId;
      request.apiKeyRole = auth.role;
      return;
    }

    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError('Bearer token is required');
    }

    const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
    let previousSigningKeyIndex: number | null = null;
    const auth = verifyAccessToken(token, dependencies.jwtAuth, {
      onPreviousSigningKeyUsed: (details) => {
        previousSigningKeyIndex = details.previousSigningKeyIndex;
      },
    });

    if (previousSigningKeyIndex !== null) {
      request.log.warn(
        {
          apiKeyId: auth.apiKeyId,
          previousSigningKeyIndex,
          route: request.url,
          tenantId: auth.tenantId,
        },
        'JWT verified with previous signing key',
      );
    }

    await dependencies.apiKeyService.assertAccessTokenIsActive(auth);
    request.tenantId = auth.tenantId;
    request.apiKeyId = auth.apiKeyId;
    request.apiKeyRole = auth.role;

    if (request.url.startsWith('/v1/admin/') && auth.role !== ApiKeyRole.ADMIN) {
      throw new ForbiddenError('Admin API key is required');
    }
  });

  server.post(TOKEN_ENDPOINT, async (request, reply) => {
    const accessToken = issueAccessToken(
      {
        apiKeyId: request.apiKeyId as string,
        tenantId: request.tenantId as string,
        role: request.apiKeyRole as ApiKeyRole,
      },
      dependencies.jwtAuth,
    );

    return reply.status(200).send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: dependencies.jwtAuth.accessTokenTtlSeconds,
    });
  });

  registerLedgerRoutes(server, {
    ledgerService: dependencies.ledgerService,
  });
  registerListingRoutes(server, {
    ledgerService: dependencies.ledgerService,
  });
  registerAdminApiKeyRoutes(server, {
    apiKeyService: dependencies.apiKeyService,
  });
};
