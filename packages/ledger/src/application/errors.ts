import { DomainError } from '../base/domain-error';

export class LedgerNotFoundError extends DomainError {
  public readonly ledgerId: string;

  public constructor(ledgerId: string) {
    super(`Ledger not found: ${ledgerId}`, 'LEDGER_NOT_FOUND', 404);
    this.ledgerId = ledgerId;
  }
}

export class AccountNotFoundError extends DomainError {
  public readonly accountId: string;

  public constructor(accountId: string) {
    super(`Account not found: ${accountId}`, 'ACCOUNT_NOT_FOUND', 404);
    this.accountId = accountId;
  }
}

export class TransactionNotFoundError extends DomainError {
  public readonly transactionId: string;

  public constructor(transactionId: string) {
    super(`Transaction not found: ${transactionId}`, 'TRANSACTION_NOT_FOUND', 404);
    this.transactionId = transactionId;
  }
}

export class HoldNotFoundError extends DomainError {
  public readonly holdId: string;

  public constructor(holdId: string) {
    super(`Hold not found: ${holdId}`, 'HOLD_NOT_FOUND', 404);
    this.holdId = holdId;
  }
}

export class InvalidHoldStateTransitionError extends DomainError {
  public constructor(from: string, to: string) {
    super(`Invalid hold state transition: ${from} -> ${to}`, 'INVALID_HOLD_STATE_TRANSITION', 409);
  }
}

export class InvariantViolationError extends DomainError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'INVARIANT_VIOLATION', 400, options);
  }
}

export class OverdraftPolicyViolationError extends DomainError {
  public readonly accountId: string;
  public readonly attemptedBalanceMinor: bigint;

  public constructor(accountId: string, attemptedBalanceMinor: bigint) {
    super(
      `Overdraft is not allowed for account ${accountId}: attempted balance ${attemptedBalanceMinor.toString()}`,
      'OVERDRAFT_POLICY_VIOLATION',
      409,
    );
    this.accountId = accountId;
    this.attemptedBalanceMinor = attemptedBalanceMinor;
  }
}

export class RepositoryError extends DomainError {
  public constructor(message = 'Persistence operation failed', options?: ErrorOptions) {
    const cause =
      options?.cause ??
      (message === 'Persistence operation failed' ? undefined : new Error(message));

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
