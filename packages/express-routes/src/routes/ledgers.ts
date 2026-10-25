import type { ApplicationServices, ledgerListFilter, WhereFor } from '@luxledger/core/application';
import { ledgerFilterFields, readWhereParameter } from '@luxledger/http';
import {
  type CreateLedgerRequest,
  createLedgerBodySchema,
  type LedgerByIdParams,
  listLedgersQuerySchema,
  type TrialBalanceParams,
} from '@luxledger/http/contracts';
import { toTrialBalanceResponse } from '@luxledger/http/mappers';
import { parseUuidParam } from '@luxledger/http/validation-utils';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { parsePaginationQuery } from '../query/pagination';
import { requireContext } from '../request/context';
import { validate } from '../request/validation';
import type { RequestWithContext } from '../types';

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
      const pagination = parsePaginationQuery(req.query);
      if (
        pagination === null ||
        validate(listLedgersQuerySchema, { ...req.query, limit: pagination.limit }) === null
      ) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const where = readWhereParameter<WhereFor<typeof ledgerListFilter>>(
        req.originalUrl,
        ledgerFilterFields,
      );
      if (where === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const context = requireContext(req);
      const result = await services.ledgers.list({
        tenantId: context.tenantId,
        ...pagination,
        where,
      });
      res.status(200).json({ data: result.data, next_cursor: result.nextCursor });
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
