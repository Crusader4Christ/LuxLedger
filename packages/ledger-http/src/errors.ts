import type { DomainError } from '@lux/ledger/base';

export type ErrorResponse = {
  error: string;
  message: string;
};

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const;

export type HttpErrorDto = {
  statusCode: number;
  code: string;
  message: string;
};

const codeToStatus: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  LEDGER_NOT_FOUND: 404,
  ACCOUNT_NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  INVARIANT_VIOLATION: 409,
};

export function mapDomainErrorToHttp(error: DomainError): HttpErrorDto {
  return {
    statusCode: codeToStatus[error.code] ?? 400,
    code: error.code,
    message: error.message,
  };
}

type ErrorWithCodeStatus = {
  code: string;
  httpStatus: number;
  message: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const isErrorWithCode = (error: unknown): error is { code: string; message: string } => {
  const record = asRecord(error);
  if (record === null) {
    return false;
  }
  return typeof record.code === 'string' && typeof record.message === 'string';
};

export const toHttpErrorPayload = (
  error: unknown,
): { statusCode: number; error: string; message: string } => {
  if (isErrorWithCode(error)) {
    const record = asRecord(error) as ErrorWithCodeStatus;
    if (
      typeof record.httpStatus === 'number' &&
      Number.isInteger(record.httpStatus) &&
      record.httpStatus >= 400 &&
      record.httpStatus <= 599
    ) {
      return {
        statusCode: record.httpStatus,
        error: error.code,
        message: error.message,
      };
    }
    const parsed = /^\d{3}$/.test(error.code) ? Number(error.code) : null;
    return {
      statusCode: parsed !== null && parsed >= 400 && parsed <= 599 ? parsed : 500,
      error: error.code,
      message: error.message,
    };
  }

  return {
    statusCode: 500,
    error: 'INTERNAL_ERROR',
    message: 'Internal server error',
  };
};

export const invalidInputPayload = (message: string): { error: 'INVALID_INPUT'; message: string } => ({
  error: 'INVALID_INPUT',
  message,
});
