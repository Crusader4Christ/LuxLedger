import { DomainError } from '../base/';

export class NotEnoughEntriesError extends DomainError {
  public constructor() {
    super('transaction must have at least 2 entries', 'NOT_ENOUGH_ENTRIES');
  }
}

export class UnbalancedTransactionError extends DomainError {
  public constructor() {
    super('total debits must equal total credits', 'UNBALANCED_TRANSACTION');
  }
}

export class InvalidDirectionError extends DomainError {
  public constructor() {
    super('posting direction must be DEBIT or CREDIT', 'INVALID_DIRECTION');
  }
}

export class InvalidAmountError extends DomainError {
  public constructor(message: string) {
    super(message, 'INVALID_AMOUNT');
  }
}

export class CurrencyMismatchError extends DomainError {
  public constructor() {
    super('currency must match', 'CURRENCY_MISMATCH');
  }
}

export class MissingReferenceError extends DomainError {
  public constructor() {
    super('transaction reference is required', 'REFERENCE_REQUIRED');
  }
}

export class AccountNotFoundError extends DomainError {
  public constructor(accountId: string) {
    super(`account not found: ${accountId}`, 'ACCOUNT_NOT_FOUND');
  }
}

export class CrossLedgerAccountError extends DomainError {
  public constructor() {
    super('account must belong to same ledger', 'ACCOUNT_LEDGER_MISMATCH');
  }
}
