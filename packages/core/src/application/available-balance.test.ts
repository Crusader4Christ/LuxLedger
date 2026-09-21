import { describe, expect, it } from 'bun:test';
import { assertAvailableBalance } from './available-balance';
import { OverdraftPolicyViolationError } from './errors';

describe('assertAvailableBalance', () => {
  const account = {
    id: 'account-1',
    overdraftPolicy: 'DISALLOW' as const,
    balanceMinor: 100n,
    inflightDebitMinor: 70n,
    inflightCreditMinor: 0n,
  };

  it('accepts zero available balance', () => {
    expect(() => assertAvailableBalance({ ...account, inflightDebitMinor: 100n })).not.toThrow();
  });

  it('rejects negative available balance for DISALLOW', () => {
    expect(() => assertAvailableBalance({ ...account, inflightDebitMinor: 101n })).toThrow(
      OverdraftPolicyViolationError,
    );
  });

  it('keeps ALLOW permissive', () => {
    expect(() =>
      assertAvailableBalance({ ...account, overdraftPolicy: 'ALLOW', inflightDebitMinor: 101n }),
    ).not.toThrow();
  });
});
