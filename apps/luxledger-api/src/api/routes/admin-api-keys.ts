import { BaseEntityRoute } from '@api/routes/base-route';
import type { CreateApiKeyBody, RevokeApiKeyParams } from '@api/routes/types/admin-api-key-route';
import { NonEmptyTrimmedStringSchema } from '@api/schema/common';
import type { ApiKeyEntity } from '@lux/ledger';
import { ApiKeyRole, type ApiKeyService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

interface ApiKeyListItemDto {
  id: string;
  tenant_id: string;
  name: string;
  role: string;
  created_at: string;
  revoked_at: string | null;
}

export class AdminApiKeyRoutes extends BaseEntityRoute<ApiKeyEntity, ApiKeyListItemDto> {
  public constructor(private readonly apiKeyService: ApiKeyService) {
    super();
  }

  protected toDto(key: ApiKeyEntity): ApiKeyListItemDto {
    return {
      id: key.id,
      tenant_id: key.tenantId,
      name: key.name,
      role: key.role,
      created_at: key.createdAt.toISOString(),
      revoked_at: key.revokedAt ? key.revokedAt.toISOString() : null,
    };
  }

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
        return this.handle(reply, async () => {
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
            key: this.dto(result.key),
          });
        });
      },
    );
  }

  private registerListApiKeys(server: FastifyInstance): void {
    server.get('/v1/admin/api-keys', async (request, reply) =>
      this.handle(reply, async () => {
        const keys = await this.apiKeyService.listApiKeys({
          apiKeyId: request.apiKeyId as string,
          tenantId: request.tenantId as string,
          role: request.apiKeyRole as ApiKeyRole,
        });

        return reply.status(200).send({
          data: this.dtoList(keys),
        });
      }),
    );
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
        return this.handle(reply, async () => {
          await this.apiKeyService.revokeApiKey(
            {
              apiKeyId: request.apiKeyId as string,
              tenantId: request.tenantId as string,
              role: request.apiKeyRole as ApiKeyRole,
            },
            request.params.id,
          );

          return reply.status(204).send();
        });
      },
    );
  }
}
