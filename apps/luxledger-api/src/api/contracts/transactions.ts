import { NonEmptyTrimmedStringSchema } from '@api/schema/common';
import { EntryDirection } from '@lux/ledger/application';

export type TransactionEntryRequestContract = {
  account_id: string;
  direction: EntryDirection;
  amount_minor: string;
  currency: string;
};

export type CreateTransactionRequestContract = {
  ledger_id: string;
  reference: string;
  currency: string;
  description?: string;
  entries: TransactionEntryRequestContract[];
};

export type CreateTransactionResponseContract = {
  transaction_id: string;
  created: boolean;
};

export type TransactionResponseContract = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  reference: string;
  currency: string;
  description: string | null;
  created_at: string;
};

export type ListTransactionsQueryContract = {
  limit?: number;
  cursor?: string;
  ledger_id?: string;
};

export type TransactionByIdParamsContract = {
  id: string;
};

export type TransactionsPageContract = {
  data: TransactionResponseContract[];
  next_cursor: string | null;
};

export const transactionEntryRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['account_id', 'direction', 'amount_minor', 'currency'],
  properties: {
    account_id: {
      type: 'string',
      format: 'uuid',
    },
    direction: {
      type: 'string',
      enum: [...Object.values(EntryDirection)],
    },
    amount_minor: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
    },
    currency: NonEmptyTrimmedStringSchema,
  },
} as const;

export const createTransactionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledger_id', 'reference', 'currency', 'entries'],
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
    reference: NonEmptyTrimmedStringSchema,
    currency: NonEmptyTrimmedStringSchema,
    description: NonEmptyTrimmedStringSchema,
    entries: {
      type: 'array',
      minItems: 2,
      items: transactionEntryRequestSchema,
    },
  },
} as const;

export const transactionResponseSchema = {
  type: 'object',
  required: ['id', 'tenant_id', 'ledger_id', 'reference', 'currency', 'description', 'created_at'],
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
    reference: {
      type: 'string',
    },
    currency: {
      type: 'string',
    },
    description: {
      type: 'string',
      nullable: true,
    },
    created_at: {
      type: 'string',
      format: 'date-time',
    },
  },
} as const;

export const transactionByIdParamsSchema = {
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

export const listTransactionsQuerySchemaExtra = {
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;
