import { AccountSide } from '@luxledger/core';
import type { ApplicationServices } from '@luxledger/core/application';
import {
  type AccountByIdParams,
  type AccountsPageResponse,
  type BalanceAsOfQuery,
  type BalanceAsOfResponse,
  type BalanceHistoryQuery,
  type BalanceHistoryResponse,
  balanceAsOfQuerySchema,
  balanceHistoryQuerySchema,
  type CreateAccountRequest,
  createAccountBodySchema,
  type ListAccountsQuery,
} from '@luxledger/http/contracts';
import { toAccountResponse } from '@luxledger/http/mappers';
import { parseUuidQuery } from '@luxledger/http/query/pagination';
import { parseUuidParam } from '@luxledger/http/validation-utils';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { parsePaginationQuery } from '../query/pagination';
import { requireContext } from '../request/context';
import { validate } from '../request/validation';
import type { RequestWithContext } from '../types';

type AccountRouteServices = Pick<ApplicationServices, 'accounts' | 'balances'>;

export const registerAccountRoutes = (app: Application, services: AccountRouteServices): void => {
  app.post('/v1/accounts', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateAccountRequest>(createAccountBodySchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const account = await services.accounts.create({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        code: body.code,
        name: body.name,
        side: body.side === 'DEBIT' ? AccountSide.DEBIT : AccountSide.CREDIT,
        overdraftPolicy: body.overdraft_policy,
        currency: body.currency,
      });
      res.status(201).json(toAccountResponse(account));
    }),
  );

  app.get('/v1/accounts/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof AccountByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const account = await services.accounts.getById(context.tenantId, params.id);
      res.status(200).json(toAccountResponse(account));
    }),
  );

  app.get('/v1/accounts', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const pagination = parsePaginationQuery(req.query);
      const ledgerId = parseUuidQuery(req.query.ledger_id);
      if (pagination === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      if (req.query.ledger_id !== undefined && ledgerId === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const query: ListAccountsQuery = {
        limit: pagination.limit,
        cursor: pagination.cursor,
        ledger_id: ledgerId ?? undefined,
      };
      const context = requireContext(req);
      const page = await services.accounts.list({
        tenantId: context.tenantId,
        limit: pagination.limit,
        cursor: query.cursor,
        ledgerId: query.ledger_id,
      });
      const response: AccountsPageResponse = {
        data: page.data.map(toAccountResponse),
        next_cursor: page.nextCursor,
      };
      res.status(200).json(response);
    }),
  );

  app.get('/v1/accounts/:id/balance-as-of', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof AccountByIdParams>(req.params.id, 'id');
      const query = validate<BalanceAsOfQuery>(balanceAsOfQuerySchema, req.query);
      if (params === null || query === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid querystring');
        return;
      }
      const context = requireContext(req);
      const result = await services.balances.getAt({
        tenantId: context.tenantId,
        accountId: params.id,
        at: new Date(query.at),
      });
      const response: BalanceAsOfResponse = {
        account_id: result.accountId,
        timestamp: result.at.toISOString(),
        posted_minor: result.postedMinor.toString(),
        inflight_debit_minor: result.inflightDebitMinor.toString(),
        inflight_credit_minor: result.inflightCreditMinor.toString(),
        available_minor: result.availableMinor.toString(),
      };
      res.status(200).json(response);
    }),
  );

  app.get('/v1/accounts/:id/balance-history', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof AccountByIdParams>(req.params.id, 'id');
      const pagination = parsePaginationQuery(req.query);
      if (params === null || pagination === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid querystring');
        return;
      }
      const query = validate<BalanceHistoryQuery>(balanceHistoryQuerySchema, {
        from: req.query.from,
        to: req.query.to,
        limit: pagination.limit,
        cursor: pagination.cursor,
      });
      if (query === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const context = requireContext(req);
      const page = await services.balances.listHistory({
        tenantId: context.tenantId,
        accountId: params.id,
        from: new Date(query.from),
        to: new Date(query.to),
        limit: pagination.limit,
        cursor: pagination.cursor,
      });
      const response: BalanceHistoryResponse = {
        data: page.data.map((item) => ({
          id: item.id,
          tenant_id: item.tenantId,
          ledger_id: item.ledgerId,
          account_id: item.accountId,
          event_type: item.eventType,
          source_id: item.sourceId,
          posted_minor: item.postedMinor.toString(),
          inflight_debit_minor: item.inflightDebitMinor.toString(),
          inflight_credit_minor: item.inflightCreditMinor.toString(),
          effective_at: item.effectiveAt.toISOString(),
          created_at: item.createdAt.toISOString(),
        })),
        next_cursor: page.nextCursor,
      };
      res.status(200).json(response);
    }),
  );
};
