import { EntryDirection } from '@lux/ledger/application';

const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

const nonEmptyTrimmedStringSchema = {
  type: 'string',
  pattern: NON_EMPTY_TRIMMED_PATTERN,
} as const;

export type TransactionEntryRequest = {
  account_id: string;
  direction: EntryDirection;
  amount_minor: string;
  currency: string;
};

export type CreateTransactionRequest = {
  ledger_id: string;
  reference: string;
  currency: string;
  description?: string;
  entries: TransactionEntryRequest[];
};

export type CreateTransactionResponse = {
  transaction_id: string;
  created: boolean;
};

export type TransactionResponse = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  reference: string;
  currency: string;
  description: string | null;
  created_at: string;
};

export type ListTransactionsQuery = {
  limit?: number;
  cursor?: string;
  ledger_id?: string;
};

export type TransactionByIdParams = {
  id: string;
};

export type TransactionsPage = {
  data: TransactionResponse[];
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
    currency: nonEmptyTrimmedStringSchema,
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
    reference: nonEmptyTrimmedStringSchema,
    currency: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema,
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
