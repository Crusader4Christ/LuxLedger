import { InvariantViolationError, LedgerNotFoundError, RepositoryError } from '@core/errors';
import type { LedgerService } from '@core/ledger-service';
import type { FastifyInstance, FastifyReply } from 'fastify';

interface LedgersRouteDependencies {
  ledgerService: LedgerService;
}
interface CreateLedgerBody {
  tenant_id: string;
  name: string;
}

interface LedgerByIdParams {
  id: string;
}

interface LedgersQuery {
  tenant_id: string;
}

const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

const sendDomainError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof LedgerNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }

  if (error instanceof InvariantViolationError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }

  if (error instanceof RepositoryError) {
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }

  throw error;
};

export const registerLedgerRoutes = (
  server: FastifyInstance,
  dependencies: LedgersRouteDependencies,
): void => {
  server.post<{ Body: CreateLedgerBody }>(
    '/v1/ledgers',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tenant_id', 'name'],
          properties: {
            tenant_id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
              pattern: NON_EMPTY_TRIMMED_PATTERN,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenant_id: tenantId, name } = request.body;

      try {
        const ledger = await dependencies.ledgerService.createLedger({
          tenantId,
          name,
        });

        return reply.status(201).send(ledger);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.get<{ Params: LedgerByIdParams }>(
    '/v1/ledgers/:id',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const ledger = await dependencies.ledgerService.getLedgerById(request.params.id);
        return reply.status(200).send(ledger);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.get<{ Querystring: LedgersQuery }>(
    '/v1/ledgers',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['tenant_id'],
          properties: {
            tenant_id: {
              type: 'string',
              format: 'uuid',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenant_id: tenantId } = request.query;

      try {
        const ledgers = await dependencies.ledgerService.getLedgersByTenant(tenantId);
        return reply.status(200).send(ledgers);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
