import type {
  CreditGrantService,
  creditGrantListFilter,
  creditLineageListFilter,
  WhereFor,
} from '@luxledger/core/application';
import {
  creditGrantFilterFields,
  creditLineageFilterFields,
  invalidWhereError,
  readWhereParameter,
  whereQueryProperty,
} from '@luxledger/http';
import {
  type CreateCreditGrantRequest,
  type CreditGrantIdParams,
  createCreditGrantBodySchema,
  creditBalanceResponseSchema,
  creditGrantExpirationResponseSchema,
  creditGrantIdParamsSchema,
  creditGrantLineageResponseSchema,
  creditGrantLotsPageResponseSchema,
  creditGrantResponseSchema,
  creditGrantsPageResponseSchema,
  type ListCreditGrantsQuery,
  listCreditGrantsQuerySchema,
  type PaginationQuery,
  type ProcessCreditGrantExpirationsRequest,
  processCreditGrantExpirationsBodySchema,
  type RefundCreditGrantRequest,
  type ReverseCreditGrantRequest,
  refundCreditGrantBodySchema,
  refundCreditGrantResponseSchema,
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
import type { FastifyInstance } from 'fastify';
import { handleValidationError } from '../errors/validation-error-handler';
import { createPaginationQuerySchema, resolvePaginationLimit } from '../query/pagination';
import { BaseRoute } from '../routing/base-route';

export class CreditGrantRoutes extends BaseRoute {
  public constructor(private readonly grants: CreditGrantService) {
    super();
  }

  public register(server: FastifyInstance): void {
    server.post<{ Body: CreateCreditGrantRequest }>(
      '/v1/credit-grants',
      {
        errorHandler: handleValidationError,
        schema: {
          body: createCreditGrantBodySchema,
          response: { 200: creditGrantResponseSchema, 201: creditGrantResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const body = request.body;
          const result = await this.grants.create({
            tenantId: request.tenantId as string,
            ledgerId: body.ledger_id,
            accountId: body.account_id,
            fundingAccountId: body.funding_account_id,
            reference: body.reference,
            externalReference: body.external_reference,
            amountMinor: BigInt(body.amount_minor),
            expiresAt: body.expires_at ? new Date(body.expires_at) : null,
          });
          return reply.status(result.created ? 201 : 200).send(toCreditGrantResponse(result.grant));
        }),
    );

    for (const [path, run] of [
      ['/v1/credit-grants/expiration/preview', false],
      ['/v1/credit-grants/expiration/run', true],
    ] as const) {
      server.post<{ Body: ProcessCreditGrantExpirationsRequest }>(
        path,
        {
          errorHandler: handleValidationError,
          schema: {
            body: processCreditGrantExpirationsBodySchema,
            response: { 200: creditGrantExpirationResponseSchema },
          },
        },
        async (request, reply) =>
          this.handle(reply, async () => {
            const input = {
              tenantId: request.tenantId as string,
              asOf: new Date(request.body.as_of),
              limit: request.body.limit,
            };
            const result = run
              ? await this.grants.runExpirations(input)
              : await this.grants.previewExpirations(input);
            return reply.status(200).send(toCreditGrantExpirationResponse(result));
          }),
      );
    }

    server.get<{ Querystring: ListCreditGrantsQuery }>(
      '/v1/credit-grants',
      {
        errorHandler: handleValidationError,
        schema: {
          querystring: {
            ...listCreditGrantsQuerySchema,
            properties: {
              ...listCreditGrantsQuerySchema.properties,
              where: whereQueryProperty(creditGrantFilterFields),
            },
          },
          response: { 200: creditGrantsPageResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof creditGrantListFilter>>(
            request.raw.url ?? '',
            creditGrantFilterFields,
          );
          if (where === null) throw invalidWhereError();
          const page = await this.grants.list({
            tenantId: request.tenantId as string,
            limit: resolvePaginationLimit(request.query.limit),
            cursor: request.query.cursor,
            accountId: request.query.account_id,
            reference: request.query.reference,
            externalReference: request.query.external_reference,
            where,
          });
          return reply.status(200).send(toPaginatedResponse(page, toCreditGrantResponse));
        }),
    );

    server.get<{ Params: CreditGrantIdParams }>(
      '/v1/credit-grants/:id',
      {
        errorHandler: handleValidationError,
        schema: { params: creditGrantIdParamsSchema, response: { 200: creditGrantResponseSchema } },
      },
      async (request, reply) =>
        this.handle(reply, async () =>
          reply
            .status(200)
            .send(
              toCreditGrantResponse(
                await this.grants.getById(request.tenantId as string, request.params.id),
              ),
            ),
        ),
    );

    server.post<{ Params: CreditGrantIdParams; Body: ReverseCreditGrantRequest }>(
      '/v1/credit-grants/:id/reversal',
      {
        errorHandler: handleValidationError,
        schema: {
          params: creditGrantIdParamsSchema,
          body: reverseCreditGrantBodySchema,
          response: { 200: creditGrantResponseSchema, 201: creditGrantResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.grants.reverse({
            tenantId: request.tenantId as string,
            grantId: request.params.id,
            reference: request.body.reference,
          });
          return reply.status(result.created ? 201 : 200).send(toCreditGrantResponse(result.grant));
        }),
    );

    server.post<{ Params: CreditGrantIdParams; Body: RefundCreditGrantRequest }>(
      '/v1/credit-grants/:id/refund',
      {
        errorHandler: handleValidationError,
        schema: {
          params: creditGrantIdParamsSchema,
          body: refundCreditGrantBodySchema,
          response: { 200: refundCreditGrantResponseSchema, 201: refundCreditGrantResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.grants.refund({
            tenantId: request.tenantId as string,
            grantId: request.params.id,
            reference: request.body.reference,
            amountMinor: BigInt(request.body.amount_minor),
          });
          return reply.status(result.created ? 201 : 200).send(toRefundCreditGrantResponse(result));
        }),
    );

    server.get<{ Params: CreditGrantIdParams; Querystring: PaginationQuery & { where?: string } }>(
      '/v1/credit-grants/:id/allocations',
      {
        errorHandler: handleValidationError,
        schema: {
          params: creditGrantIdParamsSchema,
          querystring: createPaginationQuerySchema({
            properties: { where: whereQueryProperty(creditLineageFilterFields) },
          }),
          response: { 200: creditGrantLineageResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof creditLineageListFilter>>(
            request.raw.url ?? '',
            creditLineageFilterFields,
          );
          if (where === null) throw invalidWhereError();
          return reply.status(200).send(
            toPaginatedResponse(
              await this.grants.listLineageByGrant({
                tenantId: request.tenantId as string,
                grantId: request.params.id,
                limit: resolvePaginationLimit(request.query.limit),
                cursor: request.query.cursor,
                where,
              }),
              toCreditGrantLineageItemResponse,
            ),
          );
        }),
    );

    server.get<{ Params: CreditGrantIdParams; Querystring: PaginationQuery & { where?: string } }>(
      '/v1/transactions/:id/credit-allocations',
      {
        errorHandler: handleValidationError,
        schema: {
          params: creditGrantIdParamsSchema,
          querystring: createPaginationQuerySchema({
            properties: { where: whereQueryProperty(creditLineageFilterFields) },
          }),
          response: { 200: creditGrantLineageResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof creditLineageListFilter>>(
            request.raw.url ?? '',
            creditLineageFilterFields,
          );
          if (where === null) throw invalidWhereError();
          return reply.status(200).send(
            toPaginatedResponse(
              await this.grants.listLineageByTransaction({
                tenantId: request.tenantId as string,
                transactionId: request.params.id,
                limit: resolvePaginationLimit(request.query.limit),
                cursor: request.query.cursor,
                where,
              }),
              toCreditGrantLineageItemResponse,
            ),
          );
        }),
    );

    server.get<{ Params: CreditGrantIdParams; Querystring: PaginationQuery & { where?: string } }>(
      '/v1/accounts/:id/credit-lots',
      {
        errorHandler: handleValidationError,
        schema: {
          params: creditGrantIdParamsSchema,
          querystring: createPaginationQuerySchema({
            properties: { where: whereQueryProperty(creditGrantFilterFields) },
          }),
          response: { 200: creditGrantLotsPageResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof creditGrantListFilter>>(
            request.raw.url ?? '',
            creditGrantFilterFields,
          );
          if (where === null) throw invalidWhereError();
          return reply.status(200).send(
            toPaginatedResponse(
              await this.grants.listLots({
                tenantId: request.tenantId as string,
                accountId: request.params.id,
                limit: resolvePaginationLimit(request.query.limit),
                cursor: request.query.cursor,
                where,
              }),
              toCreditGrantLotResponse,
            ),
          );
        }),
    );

    server.get<{ Params: CreditGrantIdParams }>(
      '/v1/accounts/:id/credit-balance',
      {
        errorHandler: handleValidationError,
        schema: {
          params: creditGrantIdParamsSchema,
          response: { 200: creditBalanceResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () =>
          reply
            .status(200)
            .send(
              toCreditBalanceResponse(
                await this.grants.getBalance(request.tenantId as string, request.params.id),
              ),
            ),
        ),
    );
  }
}
