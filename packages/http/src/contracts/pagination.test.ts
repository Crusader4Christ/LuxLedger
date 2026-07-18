import { describe, expect, it } from 'bun:test';
import {
  createPaginatedResponseSchema,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  paginationQuerySchema,
} from './pagination';

describe('shared pagination contracts', () => {
  it('preserves default, maximum, and cursor validation semantics', () => {
    expect(paginationQuerySchema.properties.limit).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_LIMIT,
      default: DEFAULT_PAGE_LIMIT,
    });
    expect(paginationQuerySchema.properties.cursor).toEqual({
      type: 'string',
      minLength: 1,
    });
  });

  it('requires a concrete item schema for paginated responses', () => {
    const itemSchema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    } as const;

    expect(createPaginatedResponseSchema(itemSchema).properties.data.items).toBe(itemSchema);
  });
});
