import { DomainError } from './domain-error';
import { isNonEmptyString } from './string';

class InvalidIdError extends DomainError {
  public constructor(name: string, value: string) {
    super(`${name} must be a non-empty string, got: ${value}`, 'INVALID_ID');
  }
}

export abstract class Id {
  public readonly value: string;

  protected constructor(value: string, name: string) {
    if (!isNonEmptyString(value)) {
      throw new InvalidIdError(name, value);
    }

    this.value = value;
  }

  public toString(): string {
    return this.value;
  }
}

export class TenantId extends Id {
  public constructor(value: string) {
    super(value, 'TenantId');
  }
}

export class LedgerId extends Id {
  public constructor(value: string) {
    super(value, 'LedgerId');
  }
}

export class AccountId extends Id {
  public constructor(value: string) {
    super(value, 'AccountId');
  }
}

export class TransactionId extends Id {
  public constructor(value: string) {
    super(value, 'TransactionId');
  }
}
