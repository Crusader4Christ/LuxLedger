import { whereQueryProperty } from '../query/list-filter';
import { creditGrantFilterFields, creditLineageFilterFields } from '../query/list-filter-fields';
import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';
import { createPaginatedResponseSchema, mergePaginationQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;
const minor = { type: 'string', pattern: '^[1-9][0-9]*$' } as const;
const amount = { type: 'string', pattern: '^[0-9]+$' } as const;

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
    expires_at: { type: 'string', format: 'date-time' },
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
    'expires_at',
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
    expires_at: { type: 'string', format: 'date-time', nullable: true },
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

export const refundCreditGrantBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reference', 'amount_minor'],
  properties: { reference: NonEmptyTrimmedStringSchema, amount_minor: minor },
} as const;

export const refundCreditGrantResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['grant_id', 'transaction_id', 'amount_minor', 'created'],
  properties: {
    grant_id: uuid,
    transaction_id: uuid,
    amount_minor: minor,
    created: { type: 'boolean' },
  },
} as const;

export const creditGrantLotResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'grant_id',
    'reference',
    'external_reference',
    'created_at',
    'expires_at',
    'granted_minor',
    'reversed_minor',
    'consumed_minor',
    'compensated_minor',
    'expired_minor',
    'remaining_minor',
  ],
  properties: {
    grant_id: uuid,
    reference: { type: 'string' },
    external_reference: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    expires_at: { type: 'string', format: 'date-time', nullable: true },
    granted_minor: amount,
    reversed_minor: amount,
    consumed_minor: amount,
    compensated_minor: amount,
    expired_minor: amount,
    remaining_minor: amount,
  },
} as const;

export const creditBalanceResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['account_id', 'asset_id', 'ledger_balance_minor', 'remaining_minor'],
  properties: {
    account_id: uuid,
    asset_id: uuid,
    ledger_balance_minor: amount,
    remaining_minor: amount,
  },
} as const;

export const creditGrantLineageItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['grant_id', 'entry_id', 'transaction_id', 'kind', 'amount_minor', 'created_at'],
  properties: {
    grant_id: uuid,
    entry_id: uuid,
    transaction_id: uuid,
    kind: { type: 'string', enum: ['CONSUMPTION', 'COMPENSATION', 'EXPIRATION'] },
    amount_minor: minor,
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const creditGrantLineageResponseSchema = createPaginatedResponseSchema(
  creditGrantLineageItemSchema,
);
export const creditGrantsPageResponseSchema =
  createPaginatedResponseSchema(creditGrantResponseSchema);
export const creditGrantLotsPageResponseSchema = createPaginatedResponseSchema(
  creditGrantLotResponseSchema,
);

export const listCreditGrantsQuerySchemaExtra = {
  properties: {
    where: whereQueryProperty(creditGrantFilterFields),
    account_id: uuid,
    reference: NonEmptyTrimmedStringSchema,
    external_reference: NonEmptyTrimmedStringSchema,
  },
} as const;
export const listCreditGrantsQuerySchema = mergePaginationQuerySchema(
  listCreditGrantsQuerySchemaExtra,
);
export const listCreditLineageQuerySchema = mergePaginationQuerySchema({
  properties: { where: whereQueryProperty(creditLineageFilterFields) },
});
export const listCreditLotsQuerySchema = mergePaginationQuerySchema({
  properties: { where: whereQueryProperty(creditGrantFilterFields) },
});

export const processCreditGrantExpirationsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['as_of', 'limit'],
  properties: {
    as_of: { type: 'string', format: 'date-time' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
} as const;

export const creditGrantExpirationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['as_of', 'items'],
  properties: {
    as_of: { type: 'string', format: 'date-time' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'grant_id',
          'account_id',
          'funding_account_id',
          'expires_at',
          'amount_minor',
          'cumulative_expired_minor',
          'transaction_id',
        ],
        properties: {
          grant_id: uuid,
          account_id: uuid,
          funding_account_id: uuid,
          expires_at: { type: 'string', format: 'date-time' },
          amount_minor: minor,
          cumulative_expired_minor: minor,
          transaction_id: { type: 'string', format: 'uuid', nullable: true },
        },
      },
    },
  },
} as const;

export type CreateCreditGrantRequest = InferSchema<typeof createCreditGrantBodySchema>;
export type ReverseCreditGrantRequest = InferSchema<typeof reverseCreditGrantBodySchema>;
export type RefundCreditGrantRequest = InferSchema<typeof refundCreditGrantBodySchema>;
export type RefundCreditGrantResponse = InferSchema<typeof refundCreditGrantResponseSchema>;
export type CreditGrantResponse = InferSchema<typeof creditGrantResponseSchema>;
export type CreditBalanceResponse = InferSchema<typeof creditBalanceResponseSchema>;
export type CreditGrantIdParams = InferSchema<typeof creditGrantIdParamsSchema>;
export type CreditGrantLineageResponse = InferSchema<typeof creditGrantLineageResponseSchema>;
export type CreditGrantsPageResponse = InferSchema<typeof creditGrantsPageResponseSchema>;
export type CreditGrantLotsPageResponse = InferSchema<typeof creditGrantLotsPageResponseSchema>;
export type ListCreditGrantsQuery = InferSchema<typeof listCreditGrantsQuerySchema>;
export type ProcessCreditGrantExpirationsRequest = InferSchema<
  typeof processCreditGrantExpirationsBodySchema
>;
export type CreditGrantExpirationResponse = InferSchema<typeof creditGrantExpirationResponseSchema>;
