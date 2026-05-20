import {
  type ApiKeyRole,
  type ApiKeyContract,
  type CreateApiKeyRequest,
  createApiKeyBodySchema,
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
  type RevokeApiKeyParams,
  revokeApiKeyParamsSchema,
} from '@lux/ledger-http/contracts';
import { toApiKeyContract } from '@lux/ledger-http/mappers';
import { BaseEntityRoute } from '../routes/base-route';
import type { ApiKeyEntity } from '@lux/ledger';
import type { ApiKeyService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export class AdminApiKeyRoutes extends BaseEntityRoute<ApiKeyEntity, ApiKeyContract> {
  public constructor(private readonly apiKeyService: ApiKeyService) {
    super();
  }

  protected toDto(key: ApiKeyEntity): ApiKeyContract {
    return toApiKeyContract(key);
  }

  public register(server: FastifyInstance): void {
    this.registerCreateApiKey(server);
    this.registerListApiKeys(server);
    this.registerRevokeApiKey(server);
  }

  private registerCreateApiKey(server: FastifyInstance): void {
    server.post<{ Body: CreateApiKeyRequest }>(
      '/v1/admin/api-keys',
      {
        schema: {
          body: createApiKeyBodySchema,
          response: {
            201: createApiKeyResponseSchema,
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
    server.get(
      '/v1/admin/api-keys',
      {
        schema: {
          response: {
            200: listApiKeysResponseSchema,
          },
        },
      },
      async (request, reply) =>
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
          params: revokeApiKeyParamsSchema,
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
