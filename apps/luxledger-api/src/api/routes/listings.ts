import { sendDomainError } from '@api/errors';
import { toPageResponse } from '@api/page-response';
import { InvariantViolationError } from '@services/errors';
import type { LedgerService } from '@services/ledger-service';
import type { FastifyInstance } from 'fastify';

interface ListingsRouteDependencies {
  ledgerService: LedgerService;
}

interface PaginationQuery {
  limit?: number;
  cursor?: string;
}

const paginationQuerySchema = {
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
