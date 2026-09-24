import type { CreditGrantService } from '@luxledger/core/application';
import {
  type CreateCreditGrantRequest,
  type CreditGrantIdParams,
  createCreditGrantBodySchema,
  creditBalanceResponseSchema,
  creditGrantIdParamsSchema,
  creditGrantResponseSchema,
  type ReverseCreditGrantRequest,
  reverseCreditGrantBodySchema,
} from '@luxledger/http/contracts';
import { toCreditBalanceResponse, toCreditGrantResponse } from '@luxledger/http/mappers';
import type { FastifyInstance } from 'fastify';
import { BaseRoute } from '../routing/base-route';

export class CreditGrantRoutes extends BaseRoute {
  public constructor(private readonly grants: CreditGrantService) {
    super();
  }

  public register(server: FastifyInstance): void {
    server.post<{ Body: CreateCreditGrantRequest }>(
      '/v1/credit-grants',
      {
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
            provenance: body.provenance,
            expiresAt: body.expires_at == null ? null : new Date(body.expires_at),
            amountMinor: BigInt(body.amount_minor),
            policy: {
              refundable: body.policy.refundable,
              transferable: body.policy.transferable,
              consumptionPriority: body.policy.consumption_priority,
              eligibility: body.policy.eligibility,
            },
          });
          return reply.status(result.created ? 201 : 200).send(toCreditGrantResponse(result.grant));
        }),
    );

    server.get<{ Params: CreditGrantIdParams }>(
      '/v1/credit-grants/:id',
      {
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

    server.get<{ Params: CreditGrantIdParams }>(
      '/v1/accounts/:id/credit-balance',
      {
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
