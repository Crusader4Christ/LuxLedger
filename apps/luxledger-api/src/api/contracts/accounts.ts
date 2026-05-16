import { NonEmptyTrimmedStringSchema } from '@api/schema/common';

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

export const listAccountsQuerySchemaExtra = {
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;
