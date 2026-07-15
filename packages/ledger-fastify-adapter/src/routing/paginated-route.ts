import type { PaginatedResult } from '@lux/ledger/application';
import type { PaginationQuery } from '@lux/ledger-http/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createPaginationQuerySchema, resolvePaginationLimit } from '../query/pagination';
import { BaseEntityRoute } from './base-route';

type JsonRecord = Record<string, unknown>;

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
    return resolvePaginationLimit(value);
  }

  protected querystringSchema(extra: JsonRecord = {}) {
    return createPaginationQuerySchema(extra);
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
