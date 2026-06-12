import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';
import { createPaginatedResponseSchema, mergePaginationQuerySchema } from './pagination';

export const createAccountBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledger_id', 'name', 'side', 'currency'],
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
    name: NonEmptyTrimmedStringSchema,
    side: {
      type: 'string',
      enum: ['DEBIT', 'CREDIT'],
    },
    overdraft_policy: {
      type: 'string',
      enum: ['ALLOW', 'DISALLOW'],
    },
    currency: NonEmptyTrimmedStringSchema,
  },
} as const;

export const accountResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenant_id',
    'ledger_id',
    'name',
    'side',
    'overdraft_policy',
    'currency',
    'balance_minor',
    'created_at',
  ],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    tenant_id: {
      type: 'string',
      format: 'uuid',
    },
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
    name: {
      type: 'string',
    },
    side: {
      type: 'string',
      enum: ['DEBIT', 'CREDIT'],
    },
    overdraft_policy: {
      type: 'string',
      enum: ['ALLOW', 'DISALLOW'],
    },
    currency: {
      type: 'string',
    },
    balance_minor: {
      type: 'string',
    },
    created_at: {
      type: 'string',
      format: 'date-time',
    },
  },
} as const;

export const accountByIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;

export const accountsPageResponseSchema = createPaginatedResponseSchema(accountResponseSchema);

export const balanceAsOfQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['at'],
  properties: { at: { type: 'string', format: 'date-time' } },
} as const;

export const balanceAsOfResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'account_id',
    'timestamp',
    'posted_minor',
    'inflight_debit_minor',
    'inflight_credit_minor',
    'available_minor',
  ],
  properties: {
    account_id: { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    posted_minor: { type: 'string' },
    inflight_debit_minor: { type: 'string' },
    inflight_credit_minor: { type: 'string' },
    available_minor: { type: 'string' },
  },
} as const;

const balanceHistoryQuerySchemaExtra = {
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
} as const;

export const balanceHistoryQuerySchema = mergePaginationQuerySchema(balanceHistoryQuerySchemaExtra);

export const balanceSnapshotResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenant_id',
    'ledger_id',
    'account_id',
    'event_type',
    'source_id',
    'posted_minor',
    'inflight_debit_minor',
    'inflight_credit_minor',
    'effective_at',
    'created_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    ledger_id: { type: 'string', format: 'uuid' },
    account_id: { type: 'string', format: 'uuid' },
    event_type: {
      type: 'string',
      enum: ['TX_APPLIED', 'HOLD_CREATED', 'HOLD_COMMITTED', 'HOLD_VOIDED', 'ADJUSTMENT'],
    },
    source_id: { type: 'string', format: 'uuid' },
    posted_minor: { type: 'string' },
    inflight_debit_minor: { type: 'string' },
    inflight_credit_minor: { type: 'string' },
    effective_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const balanceHistoryResponseSchema = createPaginatedResponseSchema(
  balanceSnapshotResponseSchema,
);

export const listAccountsQuerySchemaExtra = {
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;

export const listAccountsQuerySchema = mergePaginationQuerySchema(listAccountsQuerySchemaExtra);

export type CreateAccountRequest = InferSchema<typeof createAccountBodySchema>;
export type AccountResponse = InferSchema<typeof accountResponseSchema>;
export type AccountByIdParams = InferSchema<typeof accountByIdParamsSchema>;
export type ListAccountsQuery = InferSchema<typeof listAccountsQuerySchema>;
export type AccountsPageResponse = InferSchema<typeof accountsPageResponseSchema>;
export type BalanceAsOfQuery = InferSchema<typeof balanceAsOfQuerySchema>;
export type BalanceAsOfResponse = InferSchema<typeof balanceAsOfResponseSchema>;
export type BalanceHistoryQuery = InferSchema<typeof balanceHistoryQuerySchema>;
export type BalanceSnapshotResponse = InferSchema<typeof balanceSnapshotResponseSchema>;
export type BalanceHistoryResponse = InferSchema<typeof balanceHistoryResponseSchema>;
