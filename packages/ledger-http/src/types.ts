import type { DomainError } from '@lux/ledger/base';

export type HttpErrorDto = {
  statusCode: number;
  code: string;
  message: string;
};

export type HttpErrorMapper = (error: DomainError) => HttpErrorDto;
