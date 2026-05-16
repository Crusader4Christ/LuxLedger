import type { DomainError } from '@lux/ledger/base';
import type { HttpErrorDto } from './types';

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
