import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';

const uuid = { type: 'string', format: 'uuid' } as const;

export const createAdjustmentBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ledger_id',
    'account_id',
    'offset_account_id',
    'reference',
    'amount_minor',
    'description',
    'reason_code',
    'actor_id',
  ],
  properties: {
    ledger_id: uuid,
    account_id: uuid,
    offset_account_id: uuid,
    reference: NonEmptyTrimmedStringSchema,
    amount_minor: { type: 'string', pattern: '^[1-9][0-9]*$' },
    description: NonEmptyTrimmedStringSchema,
    reason_code: NonEmptyTrimmedStringSchema,
    actor_id: NonEmptyTrimmedStringSchema,
    attributes: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional caller-defined JSON object stored with the adjustment audit record.',
    },
  },
} as const;

export const adjustmentResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transaction_id', 'created'],
  properties: {
    transaction_id: uuid,
    created: { type: 'boolean' },
  },
} as const;

export type CreateAdjustmentRequest = InferSchema<typeof createAdjustmentBodySchema>;
export type AdjustmentResponse = InferSchema<typeof adjustmentResponseSchema>;
