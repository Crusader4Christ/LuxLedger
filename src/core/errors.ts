export abstract class DomainError extends Error {
  public readonly code: string;

  protected constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

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
