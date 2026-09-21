import type { ApplicationServices } from '@luxledger/core/application';
import {
  type CreateCreditGrantRequest,
  createCreditGrantBodySchema,
  type ReverseCreditGrantRequest,
  reverseCreditGrantBodySchema,
} from '@luxledger/http/contracts';
import { toCreditBalanceResponse, toCreditGrantResponse } from '@luxledger/http/mappers';
import { parseUuidParam } from '@luxledger/http/validation-utils';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { requireContext } from '../request/context';
import { validate } from '../request/validation';
import type { RequestWithContext } from '../types';

export const registerCreditGrantRoutes = (
  app: Application,
  services: Pick<ApplicationServices, 'creditGrants'>,
): void => {
  app.post('/v1/credit-grants', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateCreditGrantRequest>(createCreditGrantBodySchema, req.body);
      if (!body) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const { tenantId } = requireContext(req);
      const result = await services.creditGrants.create({
        tenantId,
        ledgerId: body.ledger_id,
        accountId: body.account_id,
        fundingAccountId: body.funding_account_id,
        assetId: body.asset_id,
        reference: body.reference,
        externalReference: body.external_reference,
        origin: body.origin,
        amountMinor: BigInt(body.amount_minor),
        policy: {
          refundable: body.policy.refundable,
          transferable: body.policy.transferable,
          consumptionPriority: body.policy.consumption_priority,
          eligibility: body.policy.eligibility,
        },
      });
      res.status(result.created ? 201 : 200).json(toCreditGrantResponse(result.grant));
    }),
  );

  app.get('/v1/credit-grants/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam(req.params.id, 'id');
      if (!params) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const { tenantId } = requireContext(req);
      res
        .status(200)
        .json(toCreditGrantResponse(await services.creditGrants.getById(tenantId, params.id)));
    }),
  );

  app.post('/v1/credit-grants/:id/reversal', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam(req.params.id, 'id');
      const body = validate<ReverseCreditGrantRequest>(reverseCreditGrantBodySchema, req.body);
      if (!params || !body) {
        sendInvalidInput(res, params ? 'Invalid request body' : 'Invalid path parameter');
        return;
      }
      const { tenantId } = requireContext(req);
      const result = await services.creditGrants.reverse({
        tenantId,
        grantId: params.id,
        reference: body.reference,
      });
      res.status(result.created ? 201 : 200).json(toCreditGrantResponse(result.grant));
    }),
  );

  app.get('/v1/accounts/:id/credit-balance', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam(req.params.id, 'id');
      if (!params) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const { tenantId } = requireContext(req);
      res
        .status(200)
        .json(toCreditBalanceResponse(await services.creditGrants.getBalance(tenantId, params.id)));
    }),
  );
};
