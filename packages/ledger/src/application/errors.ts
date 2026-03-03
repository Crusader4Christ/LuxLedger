import { DomainError } from '../base/domain-error';

export class LedgerNotFoundError extends DomainError {
  public readonly ledgerId: string;

  public constructor(ledgerId: string) {
    super(`Ledger not found: ${ledgerId}`, 'LEDGER_NOT_FOUND');
    this.ledgerId = ledgerId;
  }
}

export class InvariantViolationError extends DomainError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'INVARIANT_VIOLATION', options);
  }
}

export class RepositoryError extends DomainError {
  public constructor(message = 'Persistence operation failed', options?: ErrorOptions) {
    super(message, 'REPOSITORY_ERROR', options);
  }
}

export class UnauthorizedError extends DomainError {
  public constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends DomainError {
  public constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN');
  }
}
