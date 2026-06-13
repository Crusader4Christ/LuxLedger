import type { ApplicationServices } from '@lux/ledger/application';
import {
  type CommitHoldRequest,
  type CommitHoldResponse,
  type CreateHoldRequest,
  type CreateHoldResponse,
  commitHoldRequestSchema,
  createHoldRequestSchema,
  type HoldByIdParams,
  type VoidHoldResponse,
} from '@lux/ledger-http/contracts';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
import type { Application, Response } from 'express';
import {
  type RequestWithContext,
  requireContext,
  sendInvalidInput,
  validate,
  withDomainErrorHandling,
} from './route-support';

type HoldRouteServices = Pick<ApplicationServices, 'holds'>;

export const registerHoldRoutes = (app: Application, services: HoldRouteServices): void => {
  app.post('/v1/holds', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateHoldRequest>(createHoldRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await services.holds.create({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        reference: body.reference,
        currency: body.currency,
        description: body.description,
        entries: body.entries.map((entry) => ({
          accountId: entry.account_id,
          direction: entry.direction,
          amountMinor: BigInt(entry.amount_minor),
          currency: entry.currency,
        })),
      });
      const response: CreateHoldResponse = {
        hold_id: result.holdId,
        created: result.created,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor.toString(),
      };
      res.status(result.created ? 201 : 200).json(response);
    }),
  );

  app.post('/v1/holds/:id/commit', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof HoldByIdParams>(req.params.id, 'id');
      const body = validate<CommitHoldRequest>(commitHoldRequestSchema, req.body);
      if (params === null || body === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await services.holds.commit({
        tenantId: context.tenantId,
        holdId: params.id,
        reference: body.reference,
        amountMinor: body.amount_minor === undefined ? undefined : BigInt(body.amount_minor),
      });
      const response: CommitHoldResponse = {
        hold_id: result.holdId,
        transaction_id: result.transactionId,
        created: result.created,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor.toString(),
      };
      res.status(result.created ? 201 : 200).json(response);
    }),
  );

  app.post('/v1/holds/:id/void', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof HoldByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const result = await services.holds.void({
        tenantId: context.tenantId,
        holdId: params.id,
      });
      const response: VoidHoldResponse = {
        hold_id: result.holdId,
        state: result.state,
        voided: result.voided,
        remaining_amount_minor: result.remainingAmountMinor.toString(),
      };
      res.status(200).json(response);
    }),
  );
};
