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
  effective_at?: string;
  entries: TransactionEntryRequest[];
};

export type CreateTransactionResponse = {
  transaction_id: string;
  created: boolean;
};

export type BulkCreateTransactionRequest = {
  transactions: CreateTransactionRequest[];
};

export type BulkCreateTransactionResponse = {
  created_count: number;
  idempotent_count: number;
  transactions: Array<{
    reference: string;
    transaction_id: string;
    created: boolean;
  }>;
};

export type TransactionResponse = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  reference: string;
  currency: string;
  description: string | null;
  related_transaction_id: string | null;
  relation_type: 'REVERSAL' | 'CORRECTION' | null;
  effective_at: string;
  created_at: string;
};

export type ReverseTransactionRequest = {
  reference: string;
  description?: string;
};

export type ReverseTransactionResponse = {
  transaction_id: string;
  created: boolean;
};

export type CorrectTransactionRequest = {
  reversal_reference: string;
  corrected_reference: string;
  description?: string;
  entries: TransactionEntryRequest[];
};

export type CorrectTransactionResponse = {
  reversal_transaction_id: string;
  corrected_transaction_id: string;
  created: boolean;
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
    effective_at: {
      type: 'string',
      format: 'date-time',
    },
    entries: {
      type: 'array',
      minItems: 2,
      items: transactionEntryRequestSchema,
    },
  },
} as const;

export const bulkCreateTransactionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transactions'],
  properties: {
    transactions: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: createTransactionRequestSchema,
    },
  },
} as const;

export const bulkCreateTransactionResponseSchema = {
  type: 'object',
  required: ['created_count', 'idempotent_count', 'transactions'],
  properties: {
    created_count: {
      type: 'integer',
      minimum: 0,
    },
    idempotent_count: {
      type: 'integer',
      minimum: 0,
    },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reference', 'transaction_id', 'created'],
        properties: {
          reference: {
            type: 'string',
          },
          transaction_id: {
            type: 'string',
            format: 'uuid',
          },
          created: {
            type: 'boolean',
          },
        },
      },
    },
  },
} as const;

export const transactionResponseSchema = {
  type: 'object',
  required: [
    'id',
    'tenant_id',
    'ledger_id',
    'reference',
    'currency',
    'description',
    'related_transaction_id',
    'relation_type',
    'effective_at',
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
    related_transaction_id: {
      type: 'string',
      format: 'uuid',
      nullable: true,
    },
    relation_type: {
      type: 'string',
      enum: ['REVERSAL', 'CORRECTION'],
      nullable: true,
    },
    effective_at: {
      type: 'string',
      format: 'date-time',
    },
    created_at: {
      type: 'string',
      format: 'date-time',
    },
  },
} as const;

export const reverseTransactionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reference'],
  properties: {
    reference: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema,
  },
} as const;

export const correctTransactionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reversal_reference', 'corrected_reference', 'entries'],
  properties: {
    reversal_reference: nonEmptyTrimmedStringSchema,
    corrected_reference: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema,
    entries: {
      type: 'array',
      minItems: 2,
      items: transactionEntryRequestSchema,
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
