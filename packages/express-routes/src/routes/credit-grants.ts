import type {
  ApplicationServices,
  creditGrantListFilter,
  creditLineageListFilter,
  WhereFor,
} from '@luxledger/core/application';
import {
  creditGrantFilterFields,
  creditLineageFilterFields,
  readWhereParameter,
} from '@luxledger/http';
import {
  type CreateCreditGrantRequest,
  createCreditGrantBodySchema,
  type ProcessCreditGrantExpirationsRequest,
  processCreditGrantExpirationsBodySchema,
  type RefundCreditGrantRequest,
  type ReverseCreditGrantRequest,
  refundCreditGrantBodySchema,
  reverseCreditGrantBodySchema,
} from '@luxledger/http/contracts';
import {
  toCreditBalanceResponse,
  toCreditGrantExpirationResponse,
  toCreditGrantLineageItemResponse,
  toCreditGrantLotResponse,
  toCreditGrantResponse,
  toPaginatedResponse,
  toRefundCreditGrantResponse,
} from '@luxledger/http/mappers';
import { parseUuidQuery } from '@luxledger/http/query/pagination';
import { parseUuidParam } from '@luxledger/http/validation-utils';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { parsePaginationQuery } from '../query/pagination';
import { requireContext } from '../request/context';
import { validate } from '../request/validation';
import type { RequestWithContext } from '../types';

const parseNonEmptyQuery = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

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
        reference: body.reference,
        externalReference: body.external_reference,
        amountMinor: BigInt(body.amount_minor),
        expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      });
      res.status(result.created ? 201 : 200).json(toCreditGrantResponse(result.grant));
    }),
  );

  for (const [path, run] of [
    ['/v1/credit-grants/expiration/preview', false],
    ['/v1/credit-grants/expiration/run', true],
  ] as const) {
    app.post(path, async (req: RequestWithContext, res: Response) =>
      withDomainErrorHandling(res, async () => {
        const body = validate<ProcessCreditGrantExpirationsRequest>(
          processCreditGrantExpirationsBodySchema,
          req.body,
        );
        if (!body) {
          sendInvalidInput(res, 'Invalid request body');
          return;
        }
        const { tenantId } = requireContext(req);
        const input = { tenantId, asOf: new Date(body.as_of), limit: body.limit };
        const result = run
          ? await services.creditGrants.runExpirations(input)
          : await services.creditGrants.previewExpirations(input);
        res.status(200).json(toCreditGrantExpirationResponse(result));
      }),
    );
  }

  app.get('/v1/credit-grants', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const pagination = parsePaginationQuery(req.query);
      const where = readWhereParameter<WhereFor<typeof creditGrantListFilter>>(
        req.originalUrl,
        creditGrantFilterFields,
      );
      const accountId = parseUuidQuery(req.query.account_id);
      const reference = parseNonEmptyQuery(req.query.reference);
      const externalReference = parseNonEmptyQuery(req.query.external_reference);
      if (
        pagination === null ||
        where === null ||
        (req.query.account_id !== undefined && accountId === null) ||
        reference === null ||
        externalReference === null
      ) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const { tenantId } = requireContext(req);
      const page = await services.creditGrants.list({
        tenantId,
        limit: pagination.limit,
        cursor: pagination.cursor,
        accountId: accountId ?? undefined,
        reference,
        externalReference,
        where,
      });
      res.status(200).json(toPaginatedResponse(page, toCreditGrantResponse));
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

  app.post('/v1/credit-grants/:id/refund', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam(req.params.id, 'id');
      const body = validate<RefundCreditGrantRequest>(refundCreditGrantBodySchema, req.body);
      if (!params || !body) {
        sendInvalidInput(res, params ? 'Invalid request body' : 'Invalid path parameter');
        return;
      }
      const { tenantId } = requireContext(req);
      const result = await services.creditGrants.refund({
        tenantId,
        grantId: params.id,
        reference: body.reference,
        amountMinor: BigInt(body.amount_minor),
      });
      res.status(result.created ? 201 : 200).json(toRefundCreditGrantResponse(result));
    }),
  );

  const registerPagedGet = <Item, Dto>(
    path: string,
    load: (
      tenantId: string,
      id: string,
      page: { limit: number; cursor?: string },
    ) => Promise<{ data: Item[]; nextCursor: string | null }>,
    toDto: (item: Item) => Dto,
  ): void => {
    app.get(path, async (req: RequestWithContext, res: Response) =>
      withDomainErrorHandling(res, async () => {
        const params = parseUuidParam(req.params.id, 'id');
        if (!params) {
          sendInvalidInput(res, 'Invalid path parameter');
          return;
        }
        const pagination = parsePaginationQuery(req.query);
        const fields = path.endsWith('/credit-lots')
          ? creditGrantFilterFields
          : creditLineageFilterFields;
        const where = path.endsWith('/credit-lots')
          ? readWhereParameter<WhereFor<typeof creditGrantListFilter>>(req.originalUrl, fields)
          : readWhereParameter<WhereFor<typeof creditLineageListFilter>>(req.originalUrl, fields);
        if (pagination === null || where === null) {
          sendInvalidInput(res, 'Invalid querystring');
          return;
        }
        const { tenantId } = requireContext(req);
        res
          .status(200)
          .json(
            toPaginatedResponse(
              await load(tenantId, params.id, { ...pagination, where } as never),
              toDto,
            ),
          );
      }),
    );
  };

  registerPagedGet(
    '/v1/credit-grants/:id/allocations',
    (tenantId, grantId, page) =>
      services.creditGrants.listLineageByGrant({ tenantId, grantId, ...page }),
    toCreditGrantLineageItemResponse,
  );
  registerPagedGet(
    '/v1/transactions/:id/credit-allocations',
    (tenantId, transactionId, page) =>
      services.creditGrants.listLineageByTransaction({ tenantId, transactionId, ...page }),
    toCreditGrantLineageItemResponse,
  );
  registerPagedGet(
    '/v1/accounts/:id/credit-lots',
    (tenantId, accountId, page) => services.creditGrants.listLots({ tenantId, accountId, ...page }),
    toCreditGrantLotResponse,
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
