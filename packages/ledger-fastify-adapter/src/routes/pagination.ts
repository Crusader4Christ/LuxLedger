import type { PaginatedResult } from '@lux/ledger/application';
import { mergePaginationQuerySchema, paginationQuerySchema } from '@lux/ledger-http/contracts';
import { resolveLimit } from '@lux/ledger-http/query/pagination';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BaseEntityRoute } from '../routes/base-route';
import type { PaginationQuery } from '../types/pagination-query';

type JsonRecord = Record<string, unknown>;

export { mergePaginationQuerySchema, paginationQuerySchema };

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

  protected abstract responseSchema(): JsonRecord;

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
