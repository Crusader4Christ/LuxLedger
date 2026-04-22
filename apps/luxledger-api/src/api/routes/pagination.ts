import { sendDomainError } from '@api/errors';
import type { PaginationQuery } from '@api/routes/types/pagination-query';
import type { PaginatedResult } from '@services/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

export type PaginatedRequest = FastifyRequest<{ Querystring: PaginationQuery }>;

export abstract class BasePaginatedListRoute<Source, Target> {
  protected abstract readonly path: string;

  protected abstract list(request: PaginatedRequest): Promise<PaginatedResult<Source>>;
  protected abstract mapItem(item: Source): Target;

  protected resolveLimit(value: number | undefined): number {
    return resolveLimit(value);
  }

  public register(server: FastifyInstance): void {
    server.get<{ Querystring: PaginationQuery }>(
      this.path,
      {
        schema: {
          querystring: paginationQuerySchema,
        },
      },
      async (request, reply) => this.handle(request, reply),
    );
  }

  private async handle(request: PaginatedRequest, reply: FastifyReply): Promise<unknown> {
    try {
      const page = await this.list(request);
      return reply.status(200).send({
        data: page.data.map((item) => this.mapItem(item)),
        next_cursor: page.nextCursor,
      });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  }
}
