import { sendDomainError } from '@api/errors';
import { toPageResponse } from '@api/page-response';
import { type PaginationQuery, paginationQuerySchema, resolveLimit } from '@api/routes/pagination';
import type { LedgerService } from '@services/ledger-service';
import type { FastifyInstance } from 'fastify';

interface AccountsRouteDependencies {
  ledgerService: LedgerService;
}

export const registerAccountRoutes = (
  server: FastifyInstance,
  dependencies: AccountsRouteDependencies,
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
        const page = await dependencies.ledgerService.listAccounts({
          tenantId: request.tenantId as string,
          limit: resolveLimit(request.query.limit),
          cursor: request.query.cursor,
        });

        return reply.status(200).send(
          toPageResponse(page, (account) => ({
            id: account.id,
            tenant_id: account.tenantId,
            ledger_id: account.ledgerId,
            name: account.name,
            side: account.side,
            currency: account.currency,
            balance_minor: account.balanceMinor.toString(),
            created_at: account.createdAt.toISOString(),
          })),
        );
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
