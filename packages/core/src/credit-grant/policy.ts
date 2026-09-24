import { DomainError } from '../base/domain-error';

export interface CreditGrantPolicy {
  refundable: boolean;
  transferable: boolean;
  consumptionPriority: number;
  eligibility: string | null;
}

export class InvalidCreditGrantError extends DomainError {
  public constructor(message: string) {
    super(message, 'INVALID_CREDIT_GRANT');
  }
}

export const validateCreditGrant = (input: {
  provenance: string;
  expiresAt?: Date | null;
  amountMinor: bigint;
  policy: CreditGrantPolicy;
}): void => {
  if (
    typeof input.provenance !== 'string' ||
    input.provenance.trim().length === 0 ||
    input.provenance.trim().length > 64
  ) {
    throw new InvalidCreditGrantError('Grant provenance must contain 1 to 64 characters');
  }
  if (input.expiresAt != null && Number.isNaN(input.expiresAt.getTime())) {
    throw new InvalidCreditGrantError('Grant expiration must be a valid date');
  }
  if (input.amountMinor <= 0n || input.amountMinor > 9223372036854775807n) {
    throw new InvalidCreditGrantError('Grant amount must be a positive int64 minor-unit value');
  }
  const { policy } = input;
  if (
    !policy ||
    typeof policy.refundable !== 'boolean' ||
    typeof policy.transferable !== 'boolean' ||
    !Number.isSafeInteger(policy.consumptionPriority) ||
    policy.consumptionPriority < 0 ||
    policy.consumptionPriority > 2147483647 ||
    policy.eligibility !== null
  ) {
    throw new InvalidCreditGrantError(
      'Only unrestricted eligibility is supported in policy version 1',
    );
  }
};

export const creditGrantRemaining = (input: {
  grantedMinor: bigint;
  allocatedMinor: bigint;
  consumedMinor: bigint;
  expiredMinor: bigint;
  reversedMinor: bigint;
}): bigint => {
  const amounts = Object.values(input);
  if (amounts.some((value) => value < 0n)) {
    throw new InvalidCreditGrantError('Credit grant totals cannot be negative');
  }
  const remaining =
    input.grantedMinor -
    input.allocatedMinor -
    input.consumedMinor -
    input.expiredMinor -
    input.reversedMinor;
  if (remaining < 0n) {
    throw new InvalidCreditGrantError('Credit grant remaining capacity cannot be negative');
  }
  return remaining;
};
