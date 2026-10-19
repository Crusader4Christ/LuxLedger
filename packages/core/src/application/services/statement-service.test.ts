import { describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '../errors';
import type { StatementRepository } from '../repositories.interface';
import type { AccountStatement, CreditLotStatement } from '../types';
import { StatementService } from './statement-service';

const from = new Date('2026-01-01T00:00:00.000Z');
const asOf = new Date('2026-01-02T00:00:00.000Z');

const accountResult: AccountStatement = {
  accountId: 'account-id',
  assetId: 'asset-id',
  from,
  asOf,
  opening: { postedMinor: 0n, reservedDeltaMinor: 0n, availableMinor: 0n },
  closing: { postedMinor: 0n, reservedDeltaMinor: 0n, availableMinor: 0n },
  data: [],
  nextCursor: null,
};

const creditResult: CreditLotStatement = {
  accountId: 'account-id',
  assetId: 'asset-id',
  grantId: null,
  from,
  asOf,
  openingAvailableMinor: 0n,
  closingAvailableMinor: 0n,
  data: [],
  nextCursor: null,
};

const repository: StatementRepository = {
  getAccountStatement: async () => accountResult,
  getCreditLotStatement: async () => creditResult,
};

describe('StatementService', () => {
  const service = new StatementService(repository);

  it('delegates valid bounded statement queries', async () => {
    await expect(
      service.getAccountStatement({
        tenantId: 'tenant-id',
        accountId: 'account-id',
        from,
        asOf,
        limit: 25,
      }),
    ).resolves.toBe(accountResult);
    await expect(
      service.getCreditLotStatement({
        tenantId: 'tenant-id',
        accountId: 'account-id',
        grantId: 'grant-id',
        from,
        asOf,
        limit: 25,
      }),
    ).resolves.toBe(creditResult);
  });

  it('rejects invalid ranges, dates, limits, and blank filters', () => {
    const base = { tenantId: 'tenant-id', accountId: 'account-id', from, asOf, limit: 25 };
    expect(() => service.getAccountStatement({ ...base, from: new Date('invalid') })).toThrow(
      InvariantViolationError,
    );
    expect(() => service.getAccountStatement({ ...base, from: asOf, asOf: from })).toThrow(
      InvariantViolationError,
    );
    expect(() => service.getAccountStatement({ ...base, limit: 0 })).toThrow(
      InvariantViolationError,
    );
    expect(() => service.getCreditLotStatement({ ...base, grantId: '   ' })).toThrow(
      InvariantViolationError,
    );
  });
});
