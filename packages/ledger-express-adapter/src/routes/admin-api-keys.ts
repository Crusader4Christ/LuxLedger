import type { ApplicationServices } from '@lux/ledger/application';
import {
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
  createApiKeyBodySchema,
  type ListApiKeysResponse,
  type RevokeApiKeyParams,
} from '@lux/ledger-http/contracts';
import { toApiKeyContract } from '@lux/ledger-http/mappers';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
import type { Application, Response } from 'express';
import {
  assertAdmin,
  type RequestWithContext,
  requireContext,
  sendInvalidInput,
  validate,
  withDomainErrorHandling,
} from '../route-support';

type AdminApiKeyRouteServices = Pick<ApplicationServices, 'apiKeys'>;

export const registerAdminApiKeyRoutes = (
  app: Application,
  services: AdminApiKeyRouteServices,
): void => {
  app.get('/v1/admin/api-keys', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      assertAdmin(context);
      const keys = await services.apiKeys.listApiKeys({
        apiKeyId: context.apiKeyId,
        tenantId: context.tenantId,
        role: context.apiKeyRole,
      });
      const response: ListApiKeysResponse = {
        data: keys.map(toApiKeyContract),
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/admin/api-keys', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateApiKeyRequest>(createApiKeyBodySchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      assertAdmin(context);
      const created = await services.apiKeys.createApiKey(
        {
          apiKeyId: context.apiKeyId,
          tenantId: context.tenantId,
          role: context.apiKeyRole,
        },
        {
          tenantId: context.tenantId,
          name: body.name,
          role: body.role,
        },
      );
      const response: CreateApiKeyResponse = {
        api_key: created.apiKey,
        key: toApiKeyContract(created.key),
      };
      res.status(201).json(response);
    }),
  );

  app.post('/v1/admin/api-keys/:id/revoke', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof RevokeApiKeyParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      assertAdmin(context);
      await services.apiKeys.revokeApiKey(
        {
          apiKeyId: context.apiKeyId,
          tenantId: context.tenantId,
          role: context.apiKeyRole,
        },
        params.id,
      );
      res.status(204).send();
    }),
  );
};
