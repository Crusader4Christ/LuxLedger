import { NonEmptyTrimmedStringSchema } from './common';

// Contracts-first transport schema: this module is the shared source for
// Fastify route validation, DTO typing, and OpenAPI governance assertions.
export type CreateAccountRequest = {
  ledger_id: string;
  name: string;
  side: string;
  currency: string;
};

export type AccountResponse = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  name: string;
  side: string;
  currency: string;
  balance_minor: string;
  created_at: string;
};

export type AccountByIdParams = {
  id: string;
};

export type ListAccountsQuery = {
  limit?: number;
  cursor?: string;
  ledger_id?: string;
};

export type AccountsPageResponse = {
  data: AccountResponse[];
  next_cursor: string | null;
};

export type BalanceAsOfQuery = { at: string };
export type BalanceAsOfResponse = {
  account_id: string;
  timestamp: string;
  posted_minor: string;
  inflight_debit_minor: string;
  inflight_credit_minor: string;
  available_minor: string;
};

export type BalanceHistoryQuery = { from: string; to: string; limit?: number; cursor?: string };
export type BalanceSnapshotResponse = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  account_id: string;
  event_type: 'TX_APPLIED' | 'HOLD_CREATED' | 'HOLD_COMMITTED' | 'HOLD_VOIDED' | 'ADJUSTMENT';
  source_id: string;
  posted_minor: string;
  inflight_debit_minor: string;
  inflight_credit_minor: string;
  effective_at: string;
  created_at: string;
};
export type BalanceHistoryResponse = { data: BalanceSnapshotResponse[]; next_cursor: string | null };

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
    currency: NonEmptyTrimmedStringSchema,
  },
} as const;

export const accountResponseSchema = {
  type: 'object',
  required: [
    'id',
    'tenant_id',
    'ledger_id',
    'name',
    'side',
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

export const accountsPageResponseSchema = {
  type: 'object',
  required: ['data', 'next_cursor'],
  properties: {
    data: {
      type: 'array',
      items: accountResponseSchema,
    },
    next_cursor: {
      type: 'string',
      nullable: true,
    },
  },
} as const;

export const balanceAsOfQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['at'],
  properties: { at: { type: 'string', format: 'date-time' } },
} as const;

export const balanceAsOfResponseSchema = {
  type: 'object',
  required: ['account_id', 'timestamp', 'posted_minor', 'inflight_debit_minor', 'inflight_credit_minor', 'available_minor'],
  properties: {
    account_id: { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    posted_minor: { type: 'string' },
    inflight_debit_minor: { type: 'string' },
    inflight_credit_minor: { type: 'string' },
    available_minor: { type: 'string' },
  },
} as const;

export const balanceHistoryQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    cursor: { type: 'string' },
  },
} as const;

export const balanceSnapshotResponseSchema = {
  type: 'object',
  required: ['id', 'tenant_id', 'ledger_id', 'account_id', 'event_type', 'source_id', 'posted_minor', 'inflight_debit_minor', 'inflight_credit_minor', 'effective_at', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    ledger_id: { type: 'string', format: 'uuid' },
    account_id: { type: 'string', format: 'uuid' },
    event_type: { type: 'string', enum: ['TX_APPLIED', 'HOLD_CREATED', 'HOLD_COMMITTED', 'HOLD_VOIDED', 'ADJUSTMENT'] },
    source_id: { type: 'string', format: 'uuid' },
    posted_minor: { type: 'string' },
    inflight_debit_minor: { type: 'string' },
    inflight_credit_minor: { type: 'string' },
    effective_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const balanceHistoryResponseSchema = {
  type: 'object',
  required: ['data', 'next_cursor'],
  properties: {
    data: { type: 'array', items: balanceSnapshotResponseSchema },
    next_cursor: { type: 'string', nullable: true },
  },
} as const;

export const listAccountsQuerySchemaExtra = {
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;
