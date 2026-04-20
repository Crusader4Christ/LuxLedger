import { DomainError } from '../base/domain-error';

export class LedgerNotFoundError extends DomainError {
  public readonly ledgerId: string;

  public constructor(ledgerId: string) {
    super(`Ledger not found: ${ledgerId}`, 'LEDGER_NOT_FOUND', 404);
    this.ledgerId = ledgerId;
  }
}

export class InvariantViolationError extends DomainError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'INVARIANT_VIOLATION', 400, options);
  }
}

export class RepositoryError extends DomainError {
  public constructor(message = 'Persistence operation failed', options?: ErrorOptions) {
    const cause =
      options?.cause ?? (message === 'Persistence operation failed' ? undefined : new Error(message));

    super('Internal server error', 'INTERNAL_ERROR', 500, cause ? { ...options, cause } : options);
  }
}

export class UnauthorizedError extends DomainError {
  public constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends DomainError {
  public constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
  }
}
