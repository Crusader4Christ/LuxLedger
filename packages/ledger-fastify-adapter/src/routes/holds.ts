import {
  type CommitHoldRequest,
  commitHoldRequestSchema,
  type CreateHoldRequest,
  createHoldRequestSchema,
  type HoldByIdParams,
  holdByIdParamsSchema,
} from '@lux/ledger-http/contracts';
import { BaseRoute } from '../routes/base-route';
import type { LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export class HoldsRoutes extends BaseRoute {
  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  public register(server: FastifyInstance): void {
    this.registerCreateHold(server);
    this.registerCommitHold(server);
    this.registerVoidHold(server);
  }

  private registerCreateHold(server: FastifyInstance): void {
    server.post<{ Body: CreateHoldRequest }>(
      '/v1/holds',
      { schema: { body: createHoldRequestSchema } },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.ledgerService.createHold({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            reference: request.body.reference,
            currency: request.body.currency,
            description: request.body.description,
            entries: request.body.entries.map((entry) => ({
              accountId: entry.account_id,
              direction: entry.direction,
              amountMinor: BigInt(entry.amount_minor),
              currency: entry.currency,
            })),
          });

          return reply.status(result.created ? 201 : 200).send({
            hold_id: result.holdId,
            created: result.created,
            state: result.state,
            remaining_amount_minor: result.remainingAmountMinor.toString(),
          });
        }),
    );
  }

  private registerCommitHold(server: FastifyInstance): void {
    server.post<{ Params: HoldByIdParams; Body: CommitHoldRequest }>(
      '/v1/holds/:id/commit',
      {
        schema: {
          params: holdByIdParamsSchema,
          body: commitHoldRequestSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.ledgerService.commitHold({
            tenantId: request.tenantId as string,
            holdId: request.params.id,
            reference: request.body.reference,
            amountMinor:
              request.body.amount_minor === undefined ? undefined : BigInt(request.body.amount_minor),
          });
          return reply.status(result.created ? 201 : 200).send({
            hold_id: result.holdId,
            transaction_id: result.transactionId,
            created: result.created,
            state: result.state,
            remaining_amount_minor: result.remainingAmountMinor.toString(),
          });
        }),
    );
  }

  private registerVoidHold(server: FastifyInstance): void {
    server.post<{ Params: HoldByIdParams }>(
      '/v1/holds/:id/void',
      {
        schema: {
          params: holdByIdParamsSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.ledgerService.voidHold({
            tenantId: request.tenantId as string,
            holdId: request.params.id,
          });
          return reply.status(200).send({
            hold_id: result.holdId,
            state: result.state,
            voided: result.voided,
            remaining_amount_minor: result.remainingAmountMinor.toString(),
          });
        }),
    );
  }
}
