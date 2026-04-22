import { sendDomainError } from '@api/errors';
import { toPageResponse } from '@api/page-response';
import { type PaginationQuery, paginationQuerySchema, resolveLimit } from '@api/routes/pagination';
import { InvariantViolationError } from '@services/errors';
import type { LedgerService } from '@services/ledger-service';
import type { FastifyInstance } from 'fastify';

interface EntriesRouteDependencies {
  ledgerService: LedgerService;
}

export const registerEntryRoutes = (
  server: FastifyInstance,
  dependencies: EntriesRouteDependencies,
): void => {
  server.get<{ Querystring: PaginationQuery }>(
    '/v1/entries',
    {
      schema: {
        querystring: paginationQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const page = await dependencies.ledgerService.listEntries({
          tenantId: request.tenantId as string,
          limit: resolveLimit(request.query.limit),
          cursor: request.query.cursor,
        });

        return reply.status(200).send(
          toPageResponse(page, (entry) => {
            if (!entry.id || !entry.transactionId || !entry.createdAt) {
              throw new InvariantViolationError('entry must be persisted before listing');
            }

            return {
              id: entry.id,
              transaction_id: entry.transactionId,
              account_id: entry.accountId.value,
              direction: entry.direction,
              amount_minor: entry.money.amountMinor.toString(),
              currency: entry.money.currency,
              created_at: entry.createdAt.toISOString(),
            };
          }),
        );
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
