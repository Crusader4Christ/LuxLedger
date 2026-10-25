import type { ApiKeyEntity } from '@luxledger/core';
import type { ApiKeyService, apiKeyListFilter, WhereFor } from '@luxledger/core/application';
import { apiKeyFilterFields, invalidWhereError, readWhereParameter } from '@luxledger/http';
import {
  type ApiKeyContract,
  type ApiKeyRole,
  type CreateApiKeyRequest,
  createApiKeyBodySchema,
  createApiKeyResponseSchema,
  listApiKeysQuerySchema,
  listApiKeysResponseSchema,
  type RevokeApiKeyParams,
  revokeApiKeyParamsSchema,
} from '@luxledger/http/contracts';
import { toApiKeyContract } from '@luxledger/http/mappers';
import type { FastifyInstance } from 'fastify';
import { handleValidationError } from '../errors/validation-error-handler';
import { resolvePaginationLimit } from '../query/pagination';
import { BaseEntityRoute } from '../routing/base-route';

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
        errorHandler: handleValidationError,
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
    server.get<{ Querystring: { where?: string; limit?: number; cursor?: string } }>(
      '/v1/admin/api-keys',
      {
        errorHandler: handleValidationError,
        schema: {
          querystring: listApiKeysQuerySchema,
          response: {
            200: listApiKeysResponseSchema,
          },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof apiKeyListFilter>>(
            request.raw.url ?? '',
            apiKeyFilterFields,
          );
          if (where === null) throw invalidWhereError();
          const keys = await this.apiKeyService.listApiKeys(
            {
              apiKeyId: request.apiKeyId as string,
              tenantId: request.tenantId as string,
              role: request.apiKeyRole as ApiKeyRole,
            },
            {
              limit: resolvePaginationLimit(request.query.limit),
              cursor: request.query.cursor,
              where,
            },
          );

          return reply.status(200).send({
            data: this.dtoList(keys.data),
            next_cursor: keys.nextCursor,
          });
        }),
    );
  }

  private registerRevokeApiKey(server: FastifyInstance): void {
    server.post<{ Params: RevokeApiKeyParams }>(
      '/v1/admin/api-keys/:id/revoke',
      {
        errorHandler: handleValidationError,
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
