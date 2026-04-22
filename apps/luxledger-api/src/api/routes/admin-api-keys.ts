import { sendDomainError } from '@api/errors';
import type { CreateApiKeyBody, RevokeApiKeyParams } from '@api/routes/types/admin-api-key-route';
import { NonEmptyTrimmedStringSchema } from '@api/schema/common';
import { ApiKeyRole } from '@lux/ledger';
import type { ApiKeyService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export class AdminApiKeyRoutes {
  public constructor(private readonly apiKeyService: ApiKeyService) {}

  public register(server: FastifyInstance): void {
    this.registerCreateApiKey(server);
    this.registerListApiKeys(server);
    this.registerRevokeApiKey(server);
  }

  private registerCreateApiKey(server: FastifyInstance): void {
    server.post<{ Body: CreateApiKeyBody }>(
      '/v1/admin/api-keys',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'role'],
            properties: {
              name: NonEmptyTrimmedStringSchema,
              role: {
                type: 'string',
                enum: [...Object.values(ApiKeyRole)],
              },
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const result = await this.apiKeyService.createApiKey(
            {
              apiKeyId: request.apiKeyId as string,
              tenantId: request.tenantId as string,
              role: request.apiKeyRole as ApiKeyRole,
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
  }

  private registerListApiKeys(server: FastifyInstance): void {
    server.get('/v1/admin/api-keys', async (request, reply) => {
      try {
        const keys = await this.apiKeyService.listApiKeys({
          apiKeyId: request.apiKeyId as string,
          tenantId: request.tenantId as string,
          role: request.apiKeyRole as ApiKeyRole,
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
  }

  private registerRevokeApiKey(server: FastifyInstance): void {
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
          await this.apiKeyService.revokeApiKey(
            {
              apiKeyId: request.apiKeyId as string,
              tenantId: request.tenantId as string,
              role: request.apiKeyRole as ApiKeyRole,
            },
            request.params.id,
          );

          return reply.status(204).send();
        } catch (error) {
          return sendDomainError(reply, error);
        }
      },
    );
  }
}
