import { DomainError } from '../base/domain-error';

export class InvalidAccountSideError extends DomainError {
  public constructor() {
    super('account side must be DEBIT or CREDIT', 'INVALID_ACCOUNT_SIDE');
  }
}
