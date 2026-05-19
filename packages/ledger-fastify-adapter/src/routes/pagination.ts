import { BaseEntityRoute } from '../routes/base-route';
import type { PaginationQuery } from '../types/pagination-query';
import { deepMerge, resolveLimit } from '@lux/ledger-http/adapter-utils';
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

type JsonRecord = Record<string, unknown>;

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
