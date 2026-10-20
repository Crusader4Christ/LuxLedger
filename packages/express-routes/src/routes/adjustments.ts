import type { ApplicationServices } from '@luxledger/core/application';
import {
  type CreateAdjustmentRequest,
  createAdjustmentBodySchema,
} from '@luxledger/http/contracts';
import { toAdjustmentResponse } from '@luxledger/http/mappers';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { requireContext } from '../request/context';
import { validate } from '../request/validation';
import type { RequestWithContext } from '../types';

export const registerAdjustmentRoutes = (
  app: Application,
  services: Pick<ApplicationServices, 'adjustments'>,
): void => {
  for (const [path, direction] of [
    ['/v1/adjustments/credit', 'credit'],
    ['/v1/adjustments/debit', 'debit'],
  ] as const) {
    app.post(path, async (req: RequestWithContext, res: Response) =>
      withDomainErrorHandling(res, async () => {
        const body = validate<CreateAdjustmentRequest>(createAdjustmentBodySchema, req.body);
        if (!body) {
          sendInvalidInput(res, 'Invalid request body');
          return;
        }
        const { tenantId } = requireContext(req);
        const result = await services.adjustments[direction]({
          tenantId,
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
        res.status(result.created ? 201 : 200).json(toAdjustmentResponse(result));
      }),
    );
  }
};
