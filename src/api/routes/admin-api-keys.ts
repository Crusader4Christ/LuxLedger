import { sendDomainError } from '@api/errors';
import type { ApiKeyService } from '@core/api-key-service';
import type { FastifyInstance } from 'fastify';

interface AdminApiKeyRouteDependencies {
  apiKeyService: ApiKeyService;
}

interface CreateApiKeyBody {
  name: string;
  role: 'ADMIN' | 'SERVICE';
}

interface RevokeApiKeyParams {
  id: string;
}

const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

export const registerAdminApiKeyRoutes = (
  server: FastifyInstance,
  dependencies: AdminApiKeyRouteDependencies,
): void => {
  server.post<{ Body: CreateApiKeyBody }>(
    '/v1/admin/api-keys',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'role'],
          properties: {
            name: {
              type: 'string',
              pattern: NON_EMPTY_TRIMMED_PATTERN,
            },
            role: {
              type: 'string',
              enum: ['ADMIN', 'SERVICE'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await dependencies.apiKeyService.createApiKey(
          {
            apiKeyId: request.apiKeyId as string,
            tenantId: request.tenantId as string,
            role: request.apiKeyRole as 'ADMIN' | 'SERVICE',
          },
          {
            tenantId: request.tenantId as string,
            name: request.body.name,
            role: request.body.role,
          },
        );

        return reply.status(201).send({
          api_key: result.apiKey,
          key: {
            id: result.key.id,
            tenant_id: result.key.tenantId,
            name: result.key.name,
            role: result.key.role,
            created_at: result.key.createdAt.toISOString(),
            revoked_at: result.key.revokedAt ? result.key.revokedAt.toISOString() : null,
          },
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.get('/v1/admin/api-keys', async (request, reply) => {
    try {
      const keys = await dependencies.apiKeyService.listApiKeys({
        apiKeyId: request.apiKeyId as string,
        tenantId: request.tenantId as string,
        role: request.apiKeyRole as 'ADMIN' | 'SERVICE',
      });

      return reply.status(200).send({
        data: keys.map((key) => ({
          id: key.id,
          tenant_id: key.tenantId,
          name: key.name,
          role: key.role,
          created_at: key.createdAt.toISOString(),
          revoked_at: key.revokedAt ? key.revokedAt.toISOString() : null,
        })),
      });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  server.post<{ Params: RevokeApiKeyParams }>(
    '/v1/admin/api-keys/:id/revoke',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await dependencies.apiKeyService.revokeApiKey(
          {
            apiKeyId: request.apiKeyId as string,
            tenantId: request.tenantId as string,
            role: request.apiKeyRole as 'ADMIN' | 'SERVICE',
          },
          request.params.id,
        );

        return reply.status(204).send();
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
