import { InvariantViolationError, LedgerNotFoundError, RepositoryError } from '@core/errors';
import type { LedgerService } from '@core/ledger-service';
import type { FastifyInstance, FastifyReply } from 'fastify';

interface LedgersRouteDependencies {
  ledgerService: LedgerService;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sendDomainError = (reply: FastifyReply, error: unknown): void => {
  if (error instanceof LedgerNotFoundError) {
    void reply.status(404).send({ error: error.code, message: error.message });
    return;
  }

  if (error instanceof InvariantViolationError) {
    void reply.status(400).send({ error: error.code, message: error.message });
    return;
  }

  if (error instanceof RepositoryError) {
    void reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    return;
  }

  throw error;
};

export const registerLedgerRoutes = (
  server: FastifyInstance,
  dependencies: LedgersRouteDependencies,
): void => {
  server.post('/ledgers', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const tenantId = body?.tenant_id;
    const name = body?.name;

    if (!isNonEmptyString(tenantId) || !isNonEmptyString(name)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'tenant_id and name are required',
      });
    }

    try {
      const ledger = await dependencies.ledgerService.createLedger({
        tenantId,
        name,
      });

      return reply.status(201).send(ledger);
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  server.get('/ledgers/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const id = params?.id;

    if (!isNonEmptyString(id)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'id is required',
      });
    }

    try {
      const ledger = await dependencies.ledgerService.getLedgerById(id);
      return reply.status(200).send(ledger);
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  server.get('/ledgers', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const tenantId = query?.tenant_id;

    if (!isNonEmptyString(tenantId)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'tenant_id is required',
      });
    }

    try {
      const ledgers = await dependencies.ledgerService.getLedgersByTenant(tenantId);
      return reply.status(200).send(ledgers);
    } catch (error) {
      sendDomainError(reply, error);
    }
  });
};
