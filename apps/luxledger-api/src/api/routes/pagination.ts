import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

type PaginatedRequest = FastifyRequest<{ Querystring: PaginationQuery }>;
type PaginatedHandler = (
  request: PaginatedRequest,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

export const registerPaginatedGetRoute = (
  server: FastifyInstance,
  path: string,
  handler: PaginatedHandler,
): void => {
  server.get<{ Querystring: PaginationQuery }>(
    path,
    {
      schema: {
        querystring: paginationQuerySchema,
      },
    },
    handler,
  );
};
