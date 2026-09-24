import { DomainError } from '../base/domain-error';

export class InvalidCreditGrantError extends DomainError {
  public constructor(message: string) {
    super(message, 'INVALID_CREDIT_GRANT');
  }
}

export const validateCreditGrant = (input: { amountMinor: bigint }): void => {
  if (input.amountMinor <= 0n || input.amountMinor > 9223372036854775807n) {
    throw new InvalidCreditGrantError('Grant amount must be a positive int64 minor-unit value');
  }
};

export const creditGrantRemaining = (input: {
  grantedMinor: bigint;
  reversedMinor: bigint;
}): bigint => {
  const amounts = Object.values(input);
  if (amounts.some((value) => value < 0n)) {
    throw new InvalidCreditGrantError('Credit grant totals cannot be negative');
  }
  const remaining = input.grantedMinor - input.reversedMinor;
  if (remaining < 0n) {
    throw new InvalidCreditGrantError('Credit grant remaining capacity cannot be negative');
  }
  return remaining;
};
