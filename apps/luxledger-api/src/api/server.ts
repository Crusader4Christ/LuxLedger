import '@api/fastify-extensions';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { issueAccessToken, verifyAccessToken } from '@api/auth/jwt';
import { RateLimitExceededError, sendDomainError } from '@api/errors';
import { ApiMetrics } from '@api/observability/metrics';
import { FixedWindowLimiter } from '@api/rate-limit/fixed-window-limiter';
import type { EndpointRateLimitConfig } from '@api/rate-limit/policy';
import { AccountsListRoute } from '@api/routes/accounts';
import { AdminApiKeyRoutes } from '@api/routes/admin-api-keys';
import { EntriesListRoute } from '@api/routes/entries';
import { LedgerRoutes } from '@api/routes/ledgers';
import { TransactionsListRoute } from '@api/routes/transactions';
import type { ApplicationDependencies, CreateServerCoreOptions } from '@api/server-types';
import { ApiKeyRole, ForbiddenError, UnauthorizedError } from '@lux/ledger/application';
import Fastify, { type FastifyInstance } from 'fastify';

const API_KEY_HEADER = 'x-api-key';
const BEARER_PREFIX = 'Bearer ';
const TOKEN_ENDPOINT = '/v1/auth/token';
const V1_ROUTE_PREFIX = '/v1/';
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

interface RateLimitTarget {
  keyPrefix: 'auth_token' | 'write';
  policy: EndpointRateLimitConfig;
}

const routePath = (url: string): string => {
  const querySeparatorIndex = url.indexOf('?');
  if (querySeparatorIndex === -1) {
    return url;
  }

  return url.slice(0, querySeparatorIndex);
};

const resolveRouteLabel = (request: {
  apiPath?: string;
  routeOptions?: { url?: string };
  url: string;
}): string => {
  const routeTemplate = request.routeOptions?.url;
  if (typeof routeTemplate === 'string' && routeTemplate.length > 0) {
    return routeTemplate;
  }

  return request.apiPath ?? routePath(request.url);
};

interface RequestLogContext {
  requestId: string;
  tenantId: string | null;
  apiKeyId: string | null;
  route: string;
}

const buildRequestLogContext = (
  request: { id: string; tenantId?: string; apiKeyId?: string },
  route: string,
): RequestLogContext => ({
  requestId: request.id,
  tenantId: request.tenantId ?? null,
  apiKeyId: request.apiKeyId ?? null,
  route,
});

const resolveRateLimitTarget = (
  method: string,
  path: string,
  authTokenPolicy: EndpointRateLimitConfig,
  writePolicy: EndpointRateLimitConfig,
): RateLimitTarget | null => {
  if (method !== 'POST' || !path.startsWith(V1_ROUTE_PREFIX)) {
    return null;
  }

  if (path === TOKEN_ENDPOINT) {
    return {
      keyPrefix: 'auth_token',
      policy: authTokenPolicy,
    };
  }

  return {
    keyPrefix: 'write',
    policy: writePolicy,
  };
};

export const createServerCore = (options: CreateServerCoreOptions): FastifyInstance => {
  const server = Fastify({
    logger: options.logger,
    disableRequestLogging: true,
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
    request.requestStartedAt = process.hrtime.bigint();
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
      request.log.error(
        {
          ...buildRequestLogContext(request, '/ready'),
          err: error,
        },
        'Readiness check failed',
      );
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
    if (error instanceof RateLimitExceededError) {
      reply.header('retry-after', String(error.retryAfterSeconds));
      return reply.status(429).send({
        error: error.code,
        message: error.message,
        retry_after_seconds: error.retryAfterSeconds,
      });
    }

    if (isValidationError(error)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: error.message,
      });
    }

    const hasCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string';

    if (!hasCode) {
      request.log.error(
        {
          ...buildRequestLogContext(request, resolveRouteLabel(request)),
          err: error,
        },
        'Unhandled route error',
      );
    }

    return sendDomainError(reply, error);
  });

  return server;
};

export const registerApplication = (
  server: FastifyInstance,
  dependencies: ApplicationDependencies,
): void => {
  const rateLimiter = new FixedWindowLimiter();
  const metrics = new ApiMetrics();

  server.decorateRequest('tenantId');
  server.decorateRequest('apiKeyId');
  server.decorateRequest('apiKeyRole');
  server.decorateRequest('apiPath');
  server.decorateRequest('requestStartedAt');

  server.get('/metrics', async (_request, reply) =>
    reply
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .status(200)
      .send(metrics.renderPrometheus()),
  );

  server.addHook('onRequest', async (request) => {
    const path = routePath(request.url);
    request.apiPath = path;

    const target = resolveRateLimitTarget(
      request.method,
      path,
      dependencies.rateLimit.authToken,
      dependencies.rateLimit.write,
    );
    if (target === null) {
      return;
    }

    const decision = rateLimiter.consume(`${target.keyPrefix}:${request.ip}`, target.policy);
    if (decision.allowed) {
      return;
    }

    request.log.warn(
      {
        ...buildRequestLogContext(request, path),
        endpoint: path,
        limit: target.policy.maxRequests,
        method: request.method,
        scope: target.keyPrefix,
        windowSeconds: target.policy.windowSeconds,
        clientIp: request.ip,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      'Request rate limited',
    );
    throw new RateLimitExceededError(decision.retryAfterSeconds);
  });

  server.addHook('onRequest', async (request, reply) => {
    if (reply.sent) {
      return;
    }

    const path = request.apiPath ?? routePath(request.url);

    if (!path.startsWith(V1_ROUTE_PREFIX)) {
      return;
    }

    if (path === TOKEN_ENDPOINT) {
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
          ...buildRequestLogContext(request, path),
          apiKeyId: auth.apiKeyId,
          previousSigningKeyIndex,
          tenantId: auth.tenantId,
        },
        'JWT verified with previous signing key',
      );
    }

    await dependencies.apiKeyService.assertAccessTokenIsActive(auth);
    request.tenantId = auth.tenantId;
    request.apiKeyId = auth.apiKeyId;
    request.apiKeyRole = auth.role;

    if (path.startsWith('/v1/admin/') && auth.role !== ApiKeyRole.ADMIN) {
      throw new ForbiddenError('Admin API key is required');
    }
  });

  server.addHook('onResponse', async (request, reply) => {
    const route = resolveRouteLabel(request);
    const statusCode = reply.statusCode;

    const requestStartedAt = request.requestStartedAt ?? process.hrtime.bigint();
    const elapsedNanoseconds = process.hrtime.bigint() - requestStartedAt;
    const durationSeconds = Number(elapsedNanoseconds) / 1_000_000_000;
    const durationMs = durationSeconds * 1000;

    metrics.observeRequest(route, statusCode, durationSeconds);

    if (statusCode >= 400 && route === TOKEN_ENDPOINT) {
      metrics.incrementTokenIssuanceFailure(statusCode);
    }

    if ((statusCode === 401 || statusCode === 403) && route.startsWith(V1_ROUTE_PREFIX)) {
      metrics.incrementAuthFailure(route, statusCode);
    }

    request.log.info(
      {
        ...buildRequestLogContext(request, route),
        method: request.method,
        statusCode,
        durationMs,
      },
      'Request completed',
    );
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

  new LedgerRoutes(dependencies.ledgerService).register(server);
  new AccountsListRoute(dependencies.ledgerService).register(server);
  new TransactionsListRoute(dependencies.ledgerService).register(server);
  new EntriesListRoute(dependencies.ledgerService).register(server);
  new AdminApiKeyRoutes(dependencies.apiKeyService).register(server);
};
