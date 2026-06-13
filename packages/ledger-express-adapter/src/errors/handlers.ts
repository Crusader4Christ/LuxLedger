import { invalidInputPayload, toHttpErrorPayload } from '@lux/ledger-http/errors';
import { withErrorHandling } from '@lux/ledger-http/route-core';
import type { Response } from 'express';

export const sendInvalidInput = (res: Response, message: string): Response =>
  res.status(400).json(invalidInputPayload(message));

const sendDomainError = (res: Response, error: unknown): Response => {
  const payload = toHttpErrorPayload(error);
  return res.status(payload.statusCode).json({
    error: payload.error,
    message: payload.message,
    ...(payload.details === undefined ? {} : { details: payload.details }),
  });
};

export const withDomainErrorHandling = async (
  res: Response,
  handler: () => Promise<void>,
): Promise<void> => {
  await withErrorHandling(handler, (error) => {
    sendDomainError(res, error);
  });
};
