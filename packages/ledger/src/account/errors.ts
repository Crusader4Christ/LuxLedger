import { DomainError } from '../base/domain-error';

export class InvalidAccountSideError extends DomainError {
  public constructor() {
    super('account side must be DEBIT or CREDIT', 'INVALID_ACCOUNT_SIDE');
  }
}

export class InvalidOverdraftPolicyError extends DomainError {
  public constructor() {
    super('overdraft policy must be ALLOW or DISALLOW', 'INVALID_OVERDRAFT_POLICY');
  }
}
