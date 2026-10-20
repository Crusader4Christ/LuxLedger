import { invalidInputPayload } from '@luxledger/http/errors';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

type ValidationError = FastifyError & {
  validation?: unknown;
  validationContext?: string;
};

const validationMessage = (context: string | undefined): string => {
  if (context === 'params') return 'Invalid path parameter';
  if (context === 'querystring') return 'Invalid querystring';
  return 'Invalid request body';
};

export const handleValidationError = (
  error: ValidationError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void => {
  if (Array.isArray(error.validation)) {
    reply.status(400).send(invalidInputPayload(validationMessage(error.validationContext)));
    return;
  }

  throw error;
};
