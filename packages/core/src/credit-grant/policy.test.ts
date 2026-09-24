import { describe, expect, it } from 'bun:test';
import { creditGrantRemaining, InvalidCreditGrantError, validateCreditGrant } from './policy';

const grant = {
  provenance: 'purchase',
  amountMinor: 100n,
  policy: { refundable: true, transferable: true, consumptionPriority: 2, eligibility: null },
};

describe('credit grant invariants', () => {
  it('accepts opaque provenance, optional expiration and explicit policy', () => {
    expect(() => validateCreditGrant(grant)).not.toThrow();
    expect(() =>
      validateCreditGrant({
        ...grant,
        provenance: 'campaign:launch',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        policy: { ...grant.policy, refundable: false, transferable: false },
      }),
    ).not.toThrow();
  });

  it('rejects invalid provenance, amount, expiration or unsupported eligibility', () => {
    for (const amountMinor of [0n, -1n, 9223372036854775808n]) {
      expect(() => validateCreditGrant({ ...grant, amountMinor })).toThrow(InvalidCreditGrantError);
    }
    expect(() => validateCreditGrant({ ...grant, provenance: ' ' })).toThrow(
      InvalidCreditGrantError,
    );
    expect(() => validateCreditGrant({ ...grant, expiresAt: new Date('invalid') })).toThrow(
      InvalidCreditGrantError,
    );
    expect(() =>
      validateCreditGrant({
        ...grant,
        policy: { ...grant.policy, eligibility: 'region=EU' },
      }),
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
