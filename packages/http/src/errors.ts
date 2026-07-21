import type { DomainError } from '@luxledger/core/base';

export type ErrorResponse = {
  error: string;
  message: string;
  details?: Record<string, unknown>;
};

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    details: {
      type: 'object',
      additionalProperties: true,
    },
  },
} as const;

export type HttpErrorDto = {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
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
  details?: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const isErrorWithCodeAndStatus = (error: unknown): error is ErrorWithCodeStatus => {
  const record = asRecord(error);
  if (record === null) {
    return false;
  }
  return (
    error instanceof Error &&
    typeof record.code === 'string' &&
    record.code.length > 0 &&
    typeof record.message === 'string' &&
    typeof record.httpStatus === 'number' &&
    Number.isInteger(record.httpStatus) &&
    record.httpStatus >= 400 &&
    record.httpStatus <= 599
  );
};

export const toHttpErrorPayload = (
  error: unknown,
): { statusCode: number; error: string; message: string; details?: Record<string, unknown> } => {
  if (isErrorWithCodeAndStatus(error)) {
    return {
      statusCode: error.httpStatus,
      error: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    statusCode: 500,
    error: 'INTERNAL_ERROR',
    message: 'Internal server error',
  };
};

export const invalidInputPayload = (
  message: string,
): { error: 'INVALID_INPUT'; message: string } => ({
  error: 'INVALID_INPUT',
  message,
});
