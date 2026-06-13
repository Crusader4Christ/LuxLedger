import type { ApplicationServices } from '@lux/ledger/application';
import {
  type CreateLedgerRequest,
  createLedgerBodySchema,
  type LedgerByIdParams,
  type TrialBalanceParams,
} from '@lux/ledger-http/contracts';
import { toTrialBalanceResponse } from '@lux/ledger-http/mappers';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
import type { Application, Response } from 'express';
import {
  type RequestWithContext,
  requireContext,
  sendInvalidInput,
  validate,
  withDomainErrorHandling,
} from '../route-support';

type LedgerRouteServices = Pick<ApplicationServices, 'balances' | 'ledgers'>;

export const registerLedgerRoutes = (app: Application, services: LedgerRouteServices): void => {
  app.post('/v1/ledgers', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateLedgerRequest>(createLedgerBodySchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const ledger = await services.ledgers.create({
        tenantId: context.tenantId,
        name: body.name,
      });
      res.status(201).json(ledger);
    }),
  );

  app.get('/v1/ledgers', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      const ledgers = await services.ledgers.list(context.tenantId);
      res.status(200).json(ledgers);
    }),
  );

  app.get('/v1/ledgers/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof LedgerByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const ledger = await services.ledgers.getById(context.tenantId, params.id);
      res.status(200).json(ledger);
    }),
  );

  app.get('/v1/ledgers/:ledger_id/trial-balance', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof TrialBalanceParams>(req.params.ledger_id, 'ledger_id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const trialBalance = await services.balances.getTrialBalance({
        tenantId: context.tenantId,
        ledgerId: params.ledger_id,
      });
      res.status(200).json(toTrialBalanceResponse(trialBalance));
    }),
  );
};
