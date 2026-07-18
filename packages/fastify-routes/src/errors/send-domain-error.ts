import { toHttpErrorPayload } from '@luxledger/http/errors';
import type { FastifyReply } from 'fastify';

export const sendDomainError = (reply: FastifyReply, error: unknown): FastifyReply => {
  const payload = toHttpErrorPayload(error);
  return reply.status(payload.statusCode).send({
    error: payload.error,
    message: payload.message,
    ...(payload.details === undefined ? {} : { details: payload.details }),
  });
};
