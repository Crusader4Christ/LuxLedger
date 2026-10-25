import { invalidInputPayload, toHttpErrorPayload } from '@luxledger/http/errors';
import type { FastifyReply } from 'fastify';

export const sendDomainError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { validation?: unknown }).validation) &&
    (error as { validationContext?: unknown }).validationContext === 'querystring'
  ) {
    return reply.status(400).send(invalidInputPayload('Invalid querystring'));
  }
  const payload = toHttpErrorPayload(error);
  return reply.status(payload.statusCode).send({
    error: payload.error,
    message: payload.message,
    ...(payload.details === undefined ? {} : { details: payload.details }),
  });
};
