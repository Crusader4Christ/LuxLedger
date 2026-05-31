import type { EntryDirection } from '@lux/ledger/application';
import { NonEmptyTrimmedStringSchema } from './common';
import { transactionByIdParamsSchema, transactionEntryRequestSchema } from './transactions';

export type HoldEntryRequest = {
  account_id: string;
  direction: EntryDirection;
  amount_minor: string;
  currency: string;
};

export type CreateHoldRequest = {
  ledger_id: string;
  reference: string;
  currency: string;
  description?: string;
  entries: HoldEntryRequest[];
};

export type CreateHoldResponse = {
  hold_id: string;
  created: boolean;
  state: 'HELD' | 'APPLIED' | 'VOIDED';
  remaining_amount_minor: string;
};

export type CommitHoldRequest = {
  reference: string;
  amount_minor?: string;
};

export type HoldByIdParams = { id: string };

export type CommitHoldResponse = {
  hold_id: string;
  transaction_id: string;
  created: boolean;
  state: 'HELD' | 'APPLIED';
  remaining_amount_minor: string;
};

export type VoidHoldResponse = {
  hold_id: string;
  state: 'VOIDED';
  voided: boolean;
  remaining_amount_minor: string;
};

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

export { transactionByIdParamsSchema as holdByIdParamsSchema };
