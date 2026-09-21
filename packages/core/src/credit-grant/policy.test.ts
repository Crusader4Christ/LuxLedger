import { describe, expect, it } from 'bun:test';
import {
  CreditGrantOrigin,
  creditGrantRemaining,
  InvalidCreditGrantError,
  validateCreditGrant,
} from './policy';

const purchased = {
  origin: CreditGrantOrigin.PURCHASED,
  amountMinor: 100n,
  policy: { refundable: true, transferable: true, consumptionPriority: 2, eligibility: null },
};

describe('credit grant invariants', () => {
  it('accepts purchased and promotional credits with explicit policy', () => {
    expect(() => validateCreditGrant(purchased)).not.toThrow();
    expect(() =>
      validateCreditGrant({
        ...purchased,
        origin: CreditGrantOrigin.PROMOTIONAL,
        policy: { ...purchased.policy, refundable: false, transferable: false },
      }),
    ).not.toThrow();
  });

  it('rejects nonpositive or overflowing amounts and conflicting policy', () => {
    for (const amountMinor of [0n, -1n, 9223372036854775808n]) {
      expect(() => validateCreditGrant({ ...purchased, amountMinor })).toThrow(
        InvalidCreditGrantError,
      );
    }
    expect(() =>
      validateCreditGrant({ ...purchased, policy: { ...purchased.policy, refundable: false } }),
    ).toThrow(InvalidCreditGrantError);
    expect(() =>
      validateCreditGrant({ ...purchased, origin: CreditGrantOrigin.PROMOTIONAL }),
    ).toThrow(InvalidCreditGrantError);
  });

  it('derives remaining capacity without permitting a negative result', () => {
    const input = {
      grantedMinor: 100n,
      allocatedMinor: 10n,
      consumedMinor: 20n,
      expiredMinor: 5n,
      reversedMinor: 15n,
    };
    expect(creditGrantRemaining(input)).toBe(50n);
    expect(() => creditGrantRemaining({ ...input, reversedMinor: 101n })).toThrow(
      InvalidCreditGrantError,
    );
    expect(() => creditGrantRemaining({ ...input, allocatedMinor: -1n })).toThrow(
      InvalidCreditGrantError,
    );
  });
});
