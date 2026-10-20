import { CREDIT_LOT_MOVEMENT_KINDS } from '@luxledger/core/application';
import type { InferSchema } from '../schema-types';
import { mergePaginationQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;
const minor = { type: 'string', pattern: '^-?[0-9]+$' } as const;

export const statementQuerySchemaExtra = {
  required: ['from', 'as_of'],
  properties: {
    from: {
      type: 'string',
      format: 'date-time',
      description:
        'Inclusive opening boundary. Returned movements begin strictly after this instant.',
    },
    as_of: {
      type: 'string',
      format: 'date-time',
      description: 'Inclusive closing boundary. Must be greater than or equal to from.',
    },
  },
} as const;

export const statementQuerySchema = mergePaginationQuerySchema(statementQuerySchemaExtra);

export const creditLotStatementQuerySchema = mergePaginationQuerySchema({
  ...statementQuerySchemaExtra,
  properties: {
    ...statementQuerySchemaExtra.properties,
    grant_id: {
      ...uuid,
      description:
        'Optional exact lot filter. A valid UUID with no matching lot returns an empty zero-bounded statement.',
    },
  },
} as const);

const statementBalanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['posted_minor', 'reserved_delta_minor', 'available_minor'],
  properties: {
    posted_minor: minor,
    reserved_delta_minor: minor,
    available_minor: minor,
  },
} as const;

const statementMovementSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'event_type',
    'source_id',
    'posted_delta_minor',
    'reserved_delta_minor',
    'available_delta_minor',
    'effective_at',
    'created_at',
  ],
  properties: {
    id: uuid,
    event_type: {
      type: 'string',
      enum: ['TX_APPLIED', 'HOLD_CREATED', 'HOLD_COMMITTED', 'HOLD_VOIDED', 'ADJUSTMENT'],
    },
    source_id: uuid,
    posted_delta_minor: minor,
    reserved_delta_minor: minor,
    available_delta_minor: minor,
    effective_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const accountStatementResponseSchema = {
  type: 'object',
  description:
    'A bounded account statement ordered by (effective_at, id). Across all cursor pages, opening plus the sum of each movement delta equals closing for posted, reserved, and available minor units.',
  additionalProperties: false,
  required: [
    'account_id',
    'asset_id',
    'from',
    'as_of',
    'opening',
    'closing',
    'data',
    'next_cursor',
  ],
  properties: {
    account_id: uuid,
    asset_id: uuid,
    from: { type: 'string', format: 'date-time' },
    as_of: { type: 'string', format: 'date-time' },
    opening: {
      ...statementBalanceSchema,
      description: 'Account state including events effective at from.',
    },
    closing: {
      ...statementBalanceSchema,
      description: 'Account state including events effective at as_of.',
    },
    data: {
      type: 'array',
      description:
        'Page-local movements in ascending (effective_at, id) order for the interval (from, as_of]. Reconcile by summing data from every page.',
      items: statementMovementSchema,
    },
    next_cursor: {
      type: 'string',
      nullable: true,
      description: 'Opaque continuation bound to the tenant, account, from, and as_of query scope.',
    },
  },
} as const;

const creditLotMovementSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'grant_id',
    'kind',
    'source_transaction_id',
    'source_hold_id',
    'available_delta_minor',
    'remaining_minor',
    'reserved_minor',
    'available_minor',
    'effective_at',
    'created_at',
  ],
  properties: {
    id: uuid,
    grant_id: uuid,
    kind: {
      type: 'string',
      enum: CREDIT_LOT_MOVEMENT_KINDS,
    },
    source_transaction_id: { type: 'string', format: 'uuid', nullable: true },
    source_hold_id: { type: 'string', format: 'uuid', nullable: true },
    available_delta_minor: minor,
    remaining_minor: minor,
    reserved_minor: minor,
    available_minor: minor,
    effective_at: {
      type: 'string',
      format: 'date-time',
      description:
        'Capacity-version creation time used as the credit statement boundary and ordering clock.',
    },
    created_at: {
      type: 'string',
      format: 'date-time',
      description: 'Capacity-version creation time; equal to effective_at for credit movements.',
    },
  },
} as const;

export const creditLotStatementResponseSchema = {
  type: 'object',
  description:
    'A bounded credit-capacity statement ordered by (created_at, id). Across all cursor pages, opening_available_minor plus the sum of available_delta_minor equals closing_available_minor.',
  additionalProperties: false,
  required: [
    'account_id',
    'asset_id',
    'grant_id',
    'from',
    'as_of',
    'opening_available_minor',
    'closing_available_minor',
    'data',
    'next_cursor',
  ],
  properties: {
    account_id: uuid,
    asset_id: uuid,
    grant_id: { type: 'string', format: 'uuid', nullable: true },
    from: { type: 'string', format: 'date-time' },
    as_of: { type: 'string', format: 'date-time' },
    opening_available_minor: minor,
    closing_available_minor: minor,
    data: {
      type: 'array',
      description:
        'Page-local capacity movements in ascending (created_at, id) order for the interval (from, as_of]. Reconcile by summing data from every page.',
      items: creditLotMovementSchema,
    },
    next_cursor: {
      type: 'string',
      nullable: true,
      description:
        'Opaque continuation bound to the tenant, account, optional grant_id, from, and as_of query scope.',
    },
  },
} as const;

export type StatementQuery = InferSchema<typeof statementQuerySchema>;
export type CreditLotStatementQuery = InferSchema<typeof creditLotStatementQuerySchema>;
export type AccountStatementResponse = InferSchema<typeof accountStatementResponseSchema>;
export type CreditLotStatementResponse = InferSchema<typeof creditLotStatementResponseSchema>;
