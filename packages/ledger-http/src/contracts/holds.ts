import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';
import { transactionByIdParamsSchema, transactionEntryRequestSchema } from './transactions';

export const holdEntryRequestSchema = transactionEntryRequestSchema;

export const createHoldRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledger_id', 'reference', 'currency', 'entries'],
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    reference: NonEmptyTrimmedStringSchema,
    currency: NonEmptyTrimmedStringSchema,
    description: NonEmptyTrimmedStringSchema,
    entries: { type: 'array', minItems: 2, items: holdEntryRequestSchema },
  },
} as const;

export const commitHoldRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reference'],
  properties: {
    reference: NonEmptyTrimmedStringSchema,
    amount_minor: { type: 'string', pattern: '^[1-9][0-9]*$' },
  },
} as const;

export const createHoldResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hold_id', 'created', 'state', 'remaining_amount_minor'],
  properties: {
    hold_id: { type: 'string', format: 'uuid' },
    created: { type: 'boolean' },
    state: { type: 'string', enum: ['HELD', 'APPLIED', 'VOIDED'] },
    remaining_amount_minor: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

export const commitHoldResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hold_id', 'transaction_id', 'created', 'state', 'remaining_amount_minor'],
  properties: {
    hold_id: { type: 'string', format: 'uuid' },
    transaction_id: { type: 'string', format: 'uuid' },
    created: { type: 'boolean' },
    state: { type: 'string', enum: ['HELD', 'APPLIED'] },
    remaining_amount_minor: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

export const voidHoldResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hold_id', 'state', 'voided', 'remaining_amount_minor'],
  properties: {
    hold_id: { type: 'string', format: 'uuid' },
    state: { type: 'string', enum: ['VOIDED'] },
    voided: { type: 'boolean' },
    remaining_amount_minor: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

export { transactionByIdParamsSchema as holdByIdParamsSchema };

export type HoldEntryRequest = InferSchema<typeof holdEntryRequestSchema>;
export type CreateHoldRequest = InferSchema<typeof createHoldRequestSchema>;
export type CreateHoldResponse = InferSchema<typeof createHoldResponseSchema>;
export type CommitHoldRequest = InferSchema<typeof commitHoldRequestSchema>;
export type HoldByIdParams = InferSchema<typeof transactionByIdParamsSchema>;
export type CommitHoldResponse = InferSchema<typeof commitHoldResponseSchema>;
export type VoidHoldResponse = InferSchema<typeof voidHoldResponseSchema>;
