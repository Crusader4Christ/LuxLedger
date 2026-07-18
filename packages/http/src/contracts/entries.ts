import type { InferSchema } from '../schema-types';
import { createPaginatedResponseSchema, type paginationQuerySchema } from './pagination';

export const entryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'transaction_id',
    'account_id',
    'direction',
    'amount_minor',
    'currency',
    'created_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    transaction_id: { type: 'string', format: 'uuid' },
    account_id: { type: 'string', format: 'uuid' },
    direction: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
    amount_minor: { type: 'string' },
    currency: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const entriesPageResponseSchema = createPaginatedResponseSchema(entryResponseSchema);

export type ListEntriesQuery = InferSchema<typeof paginationQuerySchema>;
export type EntryResponse = InferSchema<typeof entryResponseSchema>;
export type EntriesPageResponse = InferSchema<typeof entriesPageResponseSchema>;
