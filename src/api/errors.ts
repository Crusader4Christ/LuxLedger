import { InvariantViolationError, LedgerNotFoundError, RepositoryError } from '@core/errors';
import type { FastifyReply } from 'fastify';

export const sendDomainError = (reply: FastifyReply, error: unknown): FastifyReply => {
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
