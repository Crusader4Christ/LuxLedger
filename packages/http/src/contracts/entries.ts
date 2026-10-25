import { whereQueryProperty } from '../query/list-filter';
import { entryFilterFields } from '../query/list-filter-fields';
import type { InferSchema } from '../schema-types';
import { createPaginatedResponseSchema, paginationQuerySchema } from './pagination';

export const entryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'transaction_id', 'account_id', 'signed_amount_minor', 'currency', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    transaction_id: { type: 'string', format: 'uuid' },
    account_id: { type: 'string', format: 'uuid' },
    signed_amount_minor: { type: 'string', pattern: '^-?[1-9][0-9]*$' },
    currency: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const entriesPageResponseSchema = createPaginatedResponseSchema(entryResponseSchema);

export const listEntriesQuerySchema = {
  ...paginationQuerySchema,
  properties: {
    ...paginationQuerySchema.properties,
    where: whereQueryProperty(entryFilterFields),
  },
} as const;
export type ListEntriesQuery = InferSchema<typeof listEntriesQuerySchema>;
export type EntryResponse = InferSchema<typeof entryResponseSchema>;
export type EntriesPageResponse = InferSchema<typeof entriesPageResponseSchema>;
