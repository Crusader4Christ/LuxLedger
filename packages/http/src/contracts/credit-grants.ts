import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';

const uuid = { type: 'string', format: 'uuid' } as const;
const minor = { type: 'string', pattern: '^[1-9][0-9]*$' } as const;
const amount = { type: 'string' } as const;

export const createCreditGrantBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledger_id', 'account_id', 'funding_account_id', 'reference', 'amount_minor'],
  properties: {
    ledger_id: uuid,
    account_id: uuid,
    funding_account_id: uuid,
    reference: NonEmptyTrimmedStringSchema,
    external_reference: NonEmptyTrimmedStringSchema,
    amount_minor: minor,
  },
} as const;

export const creditGrantResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenant_id',
    'ledger_id',
    'account_id',
    'funding_account_id',
    'asset_id',
    'reference',
    'external_reference',
    'amount_minor',
    'transaction_id',
    'created_at',
    'reversed_by_transaction_id',
  ],
  properties: {
    id: uuid,
    tenant_id: uuid,
    ledger_id: uuid,
    account_id: uuid,
    funding_account_id: uuid,
    asset_id: uuid,
    reference: { type: 'string' },
    external_reference: { type: 'string', nullable: true },
    amount_minor: amount,
    transaction_id: uuid,
    created_at: { type: 'string', format: 'date-time' },
    reversed_by_transaction_id: { type: 'string', format: 'uuid', nullable: true },
  },
} as const;

export const creditGrantIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: uuid },
} as const;

export const reverseCreditGrantBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reference'],
  properties: { reference: NonEmptyTrimmedStringSchema },
} as const;

export const creditGrantLotResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'grant_id',
    'reference',
    'external_reference',
    'created_at',
    'granted_minor',
    'reversed_minor',
    'remaining_minor',
  ],
  properties: {
    grant_id: uuid,
    reference: { type: 'string' },
    external_reference: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    granted_minor: amount,
    reversed_minor: amount,
    remaining_minor: amount,
  },
} as const;

export const creditBalanceResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['account_id', 'asset_id', 'ledger_balance_minor', 'remaining_minor', 'lots'],
  properties: {
    account_id: uuid,
    asset_id: uuid,
    ledger_balance_minor: amount,
    remaining_minor: amount,
    lots: { type: 'array', items: creditGrantLotResponseSchema },
  },
} as const;

export type CreateCreditGrantRequest = InferSchema<typeof createCreditGrantBodySchema>;
export type ReverseCreditGrantRequest = InferSchema<typeof reverseCreditGrantBodySchema>;
export type CreditGrantResponse = InferSchema<typeof creditGrantResponseSchema>;
export type CreditBalanceResponse = InferSchema<typeof creditBalanceResponseSchema>;
export type CreditGrantIdParams = InferSchema<typeof creditGrantIdParamsSchema>;
