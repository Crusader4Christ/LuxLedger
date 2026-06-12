import type { InferSchema } from '../schema-types';
import { isRecord } from '../validation-utils';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export const paginationQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_LIMIT,
      default: DEFAULT_PAGE_LIMIT,
    },
    cursor: {
      type: 'string',
      minLength: 1,
    },
  },
} as const;

export type PaginationQuery = InferSchema<typeof paginationQuerySchema>;

type JsonSchema = Readonly<Record<string, unknown>>;

const deepMerge = (
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = merged[key];
    merged[key] = isRecord(existing) && isRecord(value) ? deepMerge(existing, value) : value;
  }
  return merged;
};

export const mergePaginationQuerySchema = <Extra extends JsonSchema>(extra: Extra) =>
  deepMerge(paginationQuerySchema, extra) as typeof paginationQuerySchema & Extra;

export const createPaginatedResponseSchema = <ItemSchema extends JsonSchema>(
  itemSchema: ItemSchema,
) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['data', 'next_cursor'],
    properties: {
      data: {
        type: 'array',
        items: itemSchema,
      },
      next_cursor: {
        type: 'string',
        nullable: true,
      },
    },
  }) as const;

export type PaginatedResponse<Item> = {
  data: Item[];
  next_cursor: string | null;
};
