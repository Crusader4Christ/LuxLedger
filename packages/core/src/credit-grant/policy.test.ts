import { describe, expect, it } from 'bun:test';
import { creditGrantRemaining, InvalidCreditGrantError, validateCreditGrant } from './policy';

const grant = {
  amountMinor: 100n,
};

describe('credit grant invariants', () => {
  it('accepts a positive int64 issuance amount', () => {
    expect(() => validateCreditGrant(grant)).not.toThrow();
  });

  it('rejects a nonpositive or overflowing issuance amount', () => {
    for (const amountMinor of [0n, -1n, 9223372036854775808n]) {
      expect(() => validateCreditGrant({ ...grant, amountMinor })).toThrow(InvalidCreditGrantError);
    }
  });

  it('derives remaining capacity without permitting a negative result', () => {
    const input = {
      grantedMinor: 100n,
      reversedMinor: 15n,
    };
    expect(creditGrantRemaining(input)).toBe(85n);
    expect(() => creditGrantRemaining({ ...input, reversedMinor: 101n })).toThrow(
      InvalidCreditGrantError,
    );
    expect(() => creditGrantRemaining({ ...input, reversedMinor: -1n })).toThrow(
      InvalidCreditGrantError,
    );
  });
});
