export abstract class DomainError extends Error {
  public readonly code: string;

  protected constructor(message: string, code: string) {
    super(message);
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
  public constructor(message: string) {
    super(message, 'INVARIANT_VIOLATION');
  }
}
