import { sendDomainError } from '@api/errors';
import { toPageResponse } from '@api/page-response';
import { type PaginationQuery, paginationQuerySchema, resolveLimit } from '@api/routes/pagination';
import { InvariantViolationError } from '@services/errors';
import type { LedgerService } from '@services/ledger-service';
import type { FastifyInstance } from 'fastify';

interface TransactionsRouteDependencies {
  ledgerService: LedgerService;
}

export const registerTransactionRoutes = (
  server: FastifyInstance,
  dependencies: TransactionsRouteDependencies,
): void => {
  server.get<{ Querystring: PaginationQuery }>(
    '/v1/transactions',
    {
      schema: {
        querystring: paginationQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const page = await dependencies.ledgerService.listTransactions({
          tenantId: request.tenantId as string,
          limit: resolveLimit(request.query.limit),
          cursor: request.query.cursor,
        });

        return reply.status(200).send(
          toPageResponse(page, (transaction) => {
            if (!transaction.tenantId || !transaction.reference || !transaction.createdAt) {
              throw new InvariantViolationError('transaction must be persisted before listing');
            }

            return {
              id: transaction.id.value,
              tenant_id: transaction.tenantId,
              ledger_id: transaction.ledgerId.value,
              reference: transaction.reference,
              currency: transaction.currency,
              created_at: transaction.createdAt.toISOString(),
            };
          }),
        );
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
