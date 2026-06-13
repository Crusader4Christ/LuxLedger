import { ForbiddenError, UnauthorizedError } from '@lux/ledger/application';
import { ApiKeyRole } from '@lux/ledger-http/contracts';
import { invalidInputPayload, toHttpErrorPayload } from '@lux/ledger-http/errors';
import { withErrorHandling } from '@lux/ledger-http/route-core';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Request, Response } from 'express';

export type RequestContext = {
  tenantId: string;
  apiKeyId: string;
  apiKeyRole: ApiKeyRole;
};

export type RequestWithContext = Request & Partial<RequestContext>;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map<object, ValidateFunction>();

export const validate = <T>(schema: object, value: unknown): T | null => {
  const validator = validators.get(schema) ?? ajv.compile(schema);
  if (!validators.has(schema)) {
    validators.set(schema, validator);
  }
  return validator(value) ? (value as T) : null;
};

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

export const requireContext = (req: RequestWithContext): RequestContext => {
  if (!req.tenantId || !req.apiKeyId || !req.apiKeyRole) {
    throw new UnauthorizedError('Bearer token is required');
  }
  return {
    tenantId: req.tenantId,
    apiKeyId: req.apiKeyId,
    apiKeyRole: req.apiKeyRole,
  };
};

export const assertAdmin = (context: RequestContext): void => {
  if (context.apiKeyRole !== ApiKeyRole.ADMIN) {
    throw new ForbiddenError('Admin API key is required');
  }
};
