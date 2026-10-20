import type { AdjustmentService } from '@luxledger/core/application';
import {
  adjustmentResponseSchema,
  type CreateAdjustmentRequest,
  createAdjustmentBodySchema,
} from '@luxledger/http/contracts';
import { toAdjustmentResponse } from '@luxledger/http/mappers';
import type { FastifyInstance } from 'fastify';
import { handleValidationError } from '../errors/validation-error-handler';
import { BaseRoute } from '../routing/base-route';

export class AdjustmentRoutes extends BaseRoute {
  public constructor(private readonly adjustments: AdjustmentService) {
    super();
  }

  public register(server: FastifyInstance): void {
    for (const [path, direction] of [
      ['/v1/adjustments/credit', 'credit'],
      ['/v1/adjustments/debit', 'debit'],
    ] as const) {
      server.post<{ Body: CreateAdjustmentRequest }>(
        path,
        {
          errorHandler: handleValidationError,
          schema: {
            body: createAdjustmentBodySchema,
            response: { 200: adjustmentResponseSchema, 201: adjustmentResponseSchema },
          },
        },
        async (request, reply) =>
          this.handle(reply, async () => {
            const body = request.body;
            const result = await this.adjustments[direction]({
              tenantId: request.tenantId as string,
              ledgerId: body.ledger_id,
              accountId: body.account_id,
              offsetAccountId: body.offset_account_id,
              reference: body.reference,
              amountMinor: BigInt(body.amount_minor),
              description: body.description,
              reasonCode: body.reason_code,
              actorId: body.actor_id,
              attributes: body.attributes,
            });
            return reply.status(result.created ? 201 : 200).send(toAdjustmentResponse(result));
          }),
      );
    }
  }
}
