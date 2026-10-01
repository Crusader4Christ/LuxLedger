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
  consumedMinor?: bigint;
  compensatedMinor?: bigint;
  expiredMinor?: bigint;
}): bigint => {
  const consumedMinor = input.consumedMinor ?? 0n;
  const compensatedMinor = input.compensatedMinor ?? 0n;
  const expiredMinor = input.expiredMinor ?? 0n;
  const amounts = [
    input.grantedMinor,
    input.reversedMinor,
    consumedMinor,
    compensatedMinor,
    expiredMinor,
  ];
  if (amounts.some((value) => value < 0n)) {
    throw new InvalidCreditGrantError('Credit grant totals cannot be negative');
  }
  if (compensatedMinor > consumedMinor || input.reversedMinor > input.grantedMinor) {
    throw new InvalidCreditGrantError('Credit grant lineage totals are inconsistent');
  }
  const remaining =
    input.grantedMinor - input.reversedMinor - consumedMinor + compensatedMinor - expiredMinor;
  if (remaining < 0n) {
    throw new InvalidCreditGrantError('Credit grant remaining capacity cannot be negative');
  }
  return remaining;
};
