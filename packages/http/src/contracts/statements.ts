import { CREDIT_LOT_MOVEMENT_KINDS } from '@luxledger/core/application';
import type { InferSchema } from '../schema-types';
import { mergePaginationQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;
const minor = { type: 'string', pattern: '^-?[0-9]+$' } as const;

export const statementQuerySchemaExtra = {
  required: ['from', 'as_of'],
  properties: {
    from: { type: 'string', format: 'date-time' },
    as_of: { type: 'string', format: 'date-time' },
  },
} as const;

export const statementQuerySchema = mergePaginationQuerySchema(statementQuerySchemaExtra);

export const creditLotStatementQuerySchema = mergePaginationQuerySchema({
  ...statementQuerySchemaExtra,
  properties: {
    ...statementQuerySchemaExtra.properties,
    grant_id: uuid,
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
    opening: statementBalanceSchema,
    closing: statementBalanceSchema,
    data: { type: 'array', items: statementMovementSchema },
    next_cursor: { type: 'string', nullable: true },
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
    effective_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const creditLotStatementResponseSchema = {
  type: 'object',
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
    data: { type: 'array', items: creditLotMovementSchema },
    next_cursor: { type: 'string', nullable: true },
  },
} as const;

export type StatementQuery = InferSchema<typeof statementQuerySchema>;
export type CreditLotStatementQuery = InferSchema<typeof creditLotStatementQuerySchema>;
export type AccountStatementResponse = InferSchema<typeof accountStatementResponseSchema>;
export type CreditLotStatementResponse = InferSchema<typeof creditLotStatementResponseSchema>;
