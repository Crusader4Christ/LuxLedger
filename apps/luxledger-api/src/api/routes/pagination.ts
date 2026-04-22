export interface PaginationQuery {
  limit?: number;
  cursor?: string;
}

export const paginationQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
    cursor: {
      type: 'string',
      minLength: 1,
    },
  },
} as const;

export const resolveLimit = (value: number | undefined): number => value ?? 50;
