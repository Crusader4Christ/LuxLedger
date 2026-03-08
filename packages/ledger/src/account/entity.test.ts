import { describe, expect, it } from 'bun:test';

import { InvalidAccountSideError } from './errors';
import { AccountEntity, AccountSide } from './entity';

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
});
