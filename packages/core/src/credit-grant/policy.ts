import { DomainError } from '../base/domain-error';

export const CreditGrantOrigin = {
  PURCHASED: 'PURCHASED',
  PROMOTIONAL: 'PROMOTIONAL',
  TRIAL: 'TRIAL',
  COMPENSATION: 'COMPENSATION',
} as const;
export type CreditGrantOrigin = (typeof CreditGrantOrigin)[keyof typeof CreditGrantOrigin];

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
  origin: CreditGrantOrigin;
  amountMinor: bigint;
  policy: CreditGrantPolicy;
}): void => {
  if (!Object.values(CreditGrantOrigin).includes(input.origin)) {
    throw new InvalidCreditGrantError('Unknown credit grant origin');
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
    (policy.eligibility !== null &&
      (typeof policy.eligibility !== 'string' || policy.eligibility.trim().length === 0))
  ) {
    throw new InvalidCreditGrantError('Invalid credit grant policy');
  }
  if (input.origin === CreditGrantOrigin.PURCHASED && !policy.refundable) {
    throw new InvalidCreditGrantError('Purchased credits must be refundable');
  }
  if (
    input.origin === CreditGrantOrigin.PROMOTIONAL &&
    (policy.refundable || policy.transferable)
  ) {
    throw new InvalidCreditGrantError('Promotional credits cannot be refundable or transferable');
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
