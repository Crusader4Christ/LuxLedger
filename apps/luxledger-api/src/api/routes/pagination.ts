import { BaseEntityRoute } from '@api/routes/base-route';
import type { PaginationQuery } from '@api/routes/types/pagination-query';
import type { PaginatedResult } from '@lux/ledger/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';

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

type JsonRecord = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepMerge = (base: JsonRecord, extra: JsonRecord): JsonRecord => {
  const merged: JsonRecord = { ...base };
  if (!extra || Object.entries(extra).length === 0) {
    return merged;
  }

  for (const [key, value] of Object.entries(extra)) {
    const existing = merged[key];
    if (isObjectRecord(existing) && isObjectRecord(value)) {
      merged[key] = deepMerge(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
};

export const mergePaginationQuerySchema = (extra: JsonRecord = {}) =>
  deepMerge(paginationQuerySchema, extra);

export type PaginatedRequest<Query extends PaginationQuery = PaginationQuery> = FastifyRequest<{
  Querystring: Query;
}>;

export abstract class BasePaginatedRoute<
  Source,
  Target,
  Query extends PaginationQuery = PaginationQuery,
> extends BaseEntityRoute<Source, Target> {
  protected abstract readonly path: string;

  protected abstract list(request: PaginatedRequest<Query>): Promise<PaginatedResult<Source>>;

  protected resolveLimit(value: number | undefined): number {
    return resolveLimit(value);
  }

  protected querystringSchema(extra: JsonRecord = {}) {
    return mergePaginationQuerySchema(extra);
  }

  protected responseSchema() {
    return {
      type: 'object',
      required: ['data', 'next_cursor'],
      properties: {
        data: {
          type: 'array',
        },
        next_cursor: {
          type: 'string',
          nullable: true,
        },
      },
    } as const;
  }

  public register(server: FastifyInstance): void {
    server.get<{ Querystring: Query }>(
      this.path,
      {
        schema: {
          querystring: this.querystringSchema(),
          response: {
            200: this.responseSchema(),
          },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const page = await this.list(request);
          return reply.status(200).send({
            data: this.dtoList(page.data),
            next_cursor: page.nextCursor,
          });
        }),
    );
  }
}
