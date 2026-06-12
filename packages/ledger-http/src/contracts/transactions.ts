import { EntryDirection } from '@lux/ledger/application';
import type { InferSchema } from '../schema-types';
import { createPaginatedResponseSchema, mergePaginationQuerySchema } from './pagination';

const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

const nonEmptyTrimmedStringSchema = {
  type: 'string',
  pattern: NON_EMPTY_TRIMMED_PATTERN,
} as const;

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

export const createTransactionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transaction_id', 'created'],
  properties: {
    transaction_id: {
      type: 'string',
      format: 'uuid',
    },
    created: {
      type: 'boolean',
    },
  },
} as const;

export const bulkCreateTransactionResponseSchema = {
  type: 'object',
  additionalProperties: false,
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
        additionalProperties: false,
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
  additionalProperties: false,
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

export const reverseTransactionResponseSchema = createTransactionResponseSchema;

export const correctTransactionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reversal_transaction_id', 'corrected_transaction_id', 'created'],
  properties: {
    reversal_transaction_id: {
      type: 'string',
      format: 'uuid',
    },
    corrected_transaction_id: {
      type: 'string',
      format: 'uuid',
    },
    created: {
      type: 'boolean',
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

export const listTransactionsQuerySchema = mergePaginationQuerySchema(
  listTransactionsQuerySchemaExtra,
);

export const transactionsPageResponseSchema =
  createPaginatedResponseSchema(transactionResponseSchema);

export type TransactionEntryRequest = InferSchema<typeof transactionEntryRequestSchema>;
export type CreateTransactionRequest = InferSchema<typeof createTransactionRequestSchema>;
export type CreateTransactionResponse = InferSchema<typeof createTransactionResponseSchema>;
export type BulkCreateTransactionRequest = InferSchema<typeof bulkCreateTransactionRequestSchema>;
export type BulkCreateTransactionResponse = InferSchema<typeof bulkCreateTransactionResponseSchema>;
export type TransactionResponse = InferSchema<typeof transactionResponseSchema>;
export type ReverseTransactionRequest = InferSchema<typeof reverseTransactionRequestSchema>;
export type ReverseTransactionResponse = InferSchema<typeof reverseTransactionResponseSchema>;
export type CorrectTransactionRequest = InferSchema<typeof correctTransactionRequestSchema>;
export type CorrectTransactionResponse = InferSchema<typeof correctTransactionResponseSchema>;
export type ListTransactionsQuery = InferSchema<typeof listTransactionsQuerySchema>;
export type TransactionByIdParams = InferSchema<typeof transactionByIdParamsSchema>;
export type TransactionsPage = InferSchema<typeof transactionsPageResponseSchema>;
