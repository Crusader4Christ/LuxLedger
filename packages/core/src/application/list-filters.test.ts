import { describe, expect, it } from 'bun:test';
import { InvariantViolationError } from './errors';
import {
  LIST_FILTER_FIELDS,
  type ListWhere,
  serializeListWhere,
  validateListWhere,
} from './list-filters';
import type { AccountRepository } from './repositories.interface';
import { AccountService } from './services/account-service';

const uuid = '01900000-0000-7000-8000-000000000001';
describe('typed list filters', () => {
  it('accepts every resource and supported scalar/operator combination', () => {
    for (const resource of Object.keys(LIST_FILTER_FIELDS) as (keyof typeof LIST_FILTER_FIELDS)[]) {
      expect(() => validateListWhere(resource, { createdAt: { gte: new Date(0) } })).not.toThrow();
      expect(() => validateListWhere(resource, undefined)).not.toThrow();
      expect(() => validateListWhere(resource, {})).not.toThrow();
    }
    const where: ListWhere<'account'> = {
      id: { in: [uuid] },
      code: { eq: null },
      name: { ne: 'Cash' },
      grantEnabled: { eq: false },
      side: { in: ['CREDIT'] },
      balanceMinor: { gt: -10n, gte: 0n, lt: 100n, lte: 99n },
    };
    expect(() => validateListWhere('account', where)).not.toThrow();
    expect(() => validateListWhere('asset', { scale: { gte: 0, lte: 18 } })).not.toThrow();
    expect(() =>
      validateListWhere('apiKey', { role: { eq: 'SERVICE' }, revokedAt: { ne: null } }),
    ).not.toThrow();
  });

  it('rejects unsupported fields, operators, values and malformed shapes', () => {
    for (const where of [
      null,
      [],
      new Date(),
      { tenantId: { eq: uuid } },
      { name: 'Cash' },
      { name: {} },
      { name: { contains: 'Cash' } },
      { name: { gt: 'A' } },
      { name: { eq: undefined } },
      { name: { eq: { sql: 'true' } } },
      { name: { eq: ['Cash'] } },
      { name: { in: [{}] } },
      { balanceMinor: { eq: Number.NaN } },
      { name: { in: [] } },
      { name: { in: new Array(1) } },
      { name: { in: Array(101).fill('a') } },
      { balanceMinor: { gte: null } },
      { createdAt: { eq: new Date('invalid') } },
      { code: { in: [null] } },
      { constructor: { eq: 'x' } },
      { name: Object.create({ eq: 'Cash' }) },
    ])
      expect(() => validateListWhere('account', where)).toThrow(InvariantViolationError);
    expect(() => validateListWhere('asset', { scale: { eq: Infinity } })).toThrow(
      InvariantViolationError,
    );
    expect(() => validateListWhere('apiKey', { keyHash: { eq: 'secret' } })).toThrow(
      InvariantViolationError,
    );
  });

  it('derives field types, enums and nullability from core models', () => {
    const account: ListWhere<'account'> = {
      // @ts-expect-error Enum values come from AccountEntity.
      side: { eq: 'INVALID' },
      // @ts-expect-error Amounts are bigint, not number.
      balanceMinor: { eq: 10 },
      // @ts-expect-error Non-nullable entity fields do not accept null.
      name: { eq: null },
      // @ts-expect-error Range operators are unavailable on strings.
      currency: { gt: 'USD' },
      // @ts-expect-error Dates are not transport strings.
      createdAt: { eq: '2026-01-01' },
      // @ts-expect-error Boolean fields retain their entity type.
      grantEnabled: { eq: 1 },
    };
    const transaction: ListWhere<'transaction'> = {
      id: { eq: uuid },
      ledgerId: { eq: uuid },
      description: { eq: null },
      relationType: { in: ['REVERSAL', 'CORRECTION'] },
      // @ts-expect-error Persisted timestamps are always present.
      createdAt: { eq: null },
    };
    const nested: ListWhere<'transaction'> = {
      // @ts-expect-error Nested metadata is not filterable.
      metadata: { eq: {} },
    };
    const entry: ListWhere<'entry'> = {
      accountId: { eq: uuid },
      signedAmountMinor: { lt: 0n },
      currency: { eq: 'USD' },
      // @ts-expect-error Persisted entry IDs are always present.
      id: { eq: null },
    };
    const apiKey: ListWhere<'apiKey'> = {
      revokedAt: { ne: null },
      // @ts-expect-error Private fields are not part of the public allowlist.
      keyHash: { eq: 'secret' },
    };
    // Runtime checks intentionally do not repeat entity field-type validation.
    expect(() => validateListWhere('account', { side: { eq: 'INVALID' } })).not.toThrow();
    expect([account, transaction, nested, entry, apiKey]).toHaveLength(5);
  });

  it('canonicalizes field/operator order and preserves bigint/date types', () => {
    expect(serializeListWhere({ name: { eq: 'Cash' }, balanceMinor: { gt: 1n, lt: 5n } })).toBe(
      serializeListWhere({ balanceMinor: { lt: 5n, gt: 1n }, name: { eq: 'Cash' } }),
    );
    expect(serializeListWhere({ x: { eq: 1n } })).not.toBe(serializeListWhere({ x: { eq: '1' } }));
    expect(serializeListWhere({ x: { eq: new Date(0) } })).not.toBe(
      serializeListWhere({ x: { eq: new Date(0).toISOString() } }),
    );
    expect(serializeListWhere(undefined)).toBe(serializeListWhere({}));
  });

  it('validates at the service boundary before calling the persistence port', async () => {
    const queries: unknown[] = [];
    const repository: AccountRepository = {
      create: async () => {
        throw new Error('unused');
      },
      findById: async () => null,
      list: async (query) => {
        queries.push(query);
        return { data: [], nextCursor: null };
      },
    };
    const service = new AccountService(repository);
    const query = { tenantId: uuid, limit: 1, where: { name: { eq: 'Cash' } } };
    await service.list(query);
    expect(queries).toEqual([query]);
    await expect(
      service.list({ ...query, where: { tenantId: { eq: uuid } } } as never),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(queries).toHaveLength(1);
  });
});
