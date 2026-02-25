import { sendDomainError } from '@api/errors';
import type { LedgerReadService } from '@core/read-service';
import type { FastifyInstance } from 'fastify';

interface ListingsRouteDependencies {
  readService: LedgerReadService;
}

interface PaginationQuery {
  tenant_id: string;
  limit?: number;
  cursor?: string;
}

const paginationQuerySchema = {
  type: 'object',
  required: ['tenant_id'],
  properties: {
    tenant_id: {
      type: 'string',
      format: 'uuid',
    },
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

const resolveLimit = (value: number | undefined): number => value ?? 50;

export const registerListingRoutes = (
  server: FastifyInstance,
  dependencies: ListingsRouteDependencies,
): void => {
  server.get<{ Querystring: PaginationQuery }>(
    '/v1/accounts',
    {
      schema: {
        querystring: paginationQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const page = await dependencies.readService.listAccounts({
          tenantId: request.query.tenant_id,
          limit: resolveLimit(request.query.limit),
          cursor: request.query.cursor,
        });

        return reply.status(200).send({
          data: page.data.map((account) => ({
            id: account.id,
            tenant_id: account.tenantId,
            ledger_id: account.ledgerId,
            name: account.name,
            currency: account.currency,
            balance_minor: account.balanceMinor.toString(),
            created_at: account.createdAt.toISOString(),
          })),
          next_cursor: page.nextCursor,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.get<{ Querystring: PaginationQuery }>(
    '/v1/transactions',
    {
      schema: {
        querystring: paginationQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const page = await dependencies.readService.listTransactions({
          tenantId: request.query.tenant_id,
          limit: resolveLimit(request.query.limit),
          cursor: request.query.cursor,
        });

        return reply.status(200).send({
          data: page.data.map((transaction) => ({
            id: transaction.id,
            tenant_id: transaction.tenantId,
            ledger_id: transaction.ledgerId,
            reference: transaction.reference,
            currency: transaction.currency,
            created_at: transaction.createdAt.toISOString(),
          })),
          next_cursor: page.nextCursor,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.get<{ Querystring: PaginationQuery }>(
    '/v1/entries',
    {
      schema: {
        querystring: paginationQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const page = await dependencies.readService.listEntries({
          tenantId: request.query.tenant_id,
          limit: resolveLimit(request.query.limit),
          cursor: request.query.cursor,
        });

        return reply.status(200).send({
          data: page.data.map((entry) => ({
            id: entry.id,
            transaction_id: entry.transactionId,
            account_id: entry.accountId,
            direction: entry.direction,
            amount_minor: entry.amountMinor.toString(),
            currency: entry.currency,
            created_at: entry.createdAt.toISOString(),
          })),
          next_cursor: page.nextCursor,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
