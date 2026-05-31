import { describe, expect, it } from 'bun:test';
import { AccountEntity, AccountSide, OverdraftPolicy } from './entity';
import { InvalidAccountSideError, InvalidOverdraftPolicyError } from './errors';

describe('AccountEntity', () => {
  it('accepts DEBIT and CREDIT sides', () => {
    expect(
      () =>
        new AccountEntity({
          id: 'acc-1',
          tenantId: 'tenant-1',
          ledgerId: 'ledger-1',
          name: 'cash',
          side: AccountSide.DEBIT,
          currency: 'USD',
          balanceMinor: 0n,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
    ).not.toThrow();

    expect(
      () =>
        new AccountEntity({
          id: 'acc-2',
          tenantId: 'tenant-1',
          ledgerId: 'ledger-1',
          name: 'revenue',
          side: AccountSide.CREDIT,
          currency: 'USD',
          balanceMinor: 0n,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
    ).not.toThrow();
  });

  it('rejects unsupported side', () => {
    expect(
      () =>
        new AccountEntity({
          id: 'acc-1',
          tenantId: 'tenant-1',
          ledgerId: 'ledger-1',
          name: 'cash',
          side: 'INVALID' as unknown as AccountSide,
          currency: 'USD',
          balanceMinor: 0n,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
    ).toThrowError(InvalidAccountSideError);
  });

  it('defaults overdraft policy to ALLOW and accepts explicit DISALLOW', () => {
    const defaultPolicyAccount = new AccountEntity({
      id: 'acc-1',
      tenantId: 'tenant-1',
      ledgerId: 'ledger-1',
      name: 'cash',
      side: AccountSide.DEBIT,
      currency: 'USD',
      balanceMinor: 0n,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(defaultPolicyAccount.overdraftPolicy).toBe(OverdraftPolicy.ALLOW);

    const disallowPolicyAccount = new AccountEntity({
      id: 'acc-2',
      tenantId: 'tenant-1',
      ledgerId: 'ledger-1',
      name: 'cash',
      side: AccountSide.DEBIT,
      overdraftPolicy: OverdraftPolicy.DISALLOW,
      currency: 'USD',
      balanceMinor: 0n,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(disallowPolicyAccount.overdraftPolicy).toBe(OverdraftPolicy.DISALLOW);
  });

  it('rejects unsupported overdraft policy', () => {
    expect(
      () =>
        new AccountEntity({
          id: 'acc-1',
          tenantId: 'tenant-1',
          ledgerId: 'ledger-1',
          name: 'cash',
          side: AccountSide.DEBIT,
          overdraftPolicy: 'NOPE' as unknown as OverdraftPolicy,
          currency: 'USD',
          balanceMinor: 0n,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
    ).toThrowError(InvalidOverdraftPolicyError);
  });
});
