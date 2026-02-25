export class LedgerNotFoundError extends Error {
  public readonly ledgerId: string;

  public constructor(ledgerId: string) {
    super(`Ledger not found: ${ledgerId}`);
    this.name = 'LedgerNotFoundError';
    this.ledgerId = ledgerId;
  }
}

export class InvariantViolationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvariantViolationError';
  }
}
