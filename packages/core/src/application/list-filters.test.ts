import { describe, expect, it } from 'bun:test';
import { accountListFilter } from '../account/list-filter';
import { ApiKeyRole } from '../api-key/entity';
import { apiKeyListFilter } from '../api-key/list-filter';
import { entryListFilter } from '../entry/list-filter';
import { ledgerListFilter } from '../ledger/list-filter';
import { reconRuleListFilter } from '../reconciliation';
import { transactionListFilter } from '../transaction/list-filter';
import { InvariantViolationError } from './errors';
import { serializeListWhere, validateListWhere, type WhereFor } from './list-filters';
import type {
  AccountRepository,
  ApiKeyRepository,
  AssetRepository,
  LedgerRepository,
  ReconciliationApplicationRepository,
} from './repositories.interface';
import { AccountService } from './services/account-service';
import { ApiKeyService } from './services/api-key-service';
import { AssetService } from './services/asset-service';
import { LedgerService } from './services/ledger-service';
import { ReconciliationService } from './services/reconciliation-service';
import type { AccountPaginationQuery, PaginationQuery, TransactionPaginationQuery } from './types';
import {
  assetListFilter,
  balanceHistoryListFilter,
  creditGrantListFilter,
  creditLineageListFilter,
  reconResultListFilter,
} from './types';

const uuid = '01900000-0000-7000-8000-000000000001';
describe('typed list filters', () => {
  it('accepts every resource and supported scalar/operator combination', () => {
    for (const policy of [
      accountListFilter,
      transactionListFilter,
      entryListFilter,
      assetListFilter,
      ledgerListFilter,
      apiKeyListFilter,
      reconRuleListFilter,
      reconResultListFilter,
      creditGrantListFilter,
      creditLineageListFilter,
      balanceHistoryListFilter,
    ]) {
      expect(() => validateListWhere(policy, { createdAt: { gte: new Date(0) } })).not.toThrow();
      expect(() => validateListWhere(policy, undefined)).not.toThrow();
      expect(() => validateListWhere(policy, {})).not.toThrow();
    }
    const where: WhereFor<typeof accountListFilter> = {
      id: { in: [uuid] },
      code: { eq: null },
      name: { ne: 'Cash' },
      grantEnabled: { eq: false },
      side: { in: ['CREDIT'] },
      balanceMinor: { gt: -10n, gte: 0n, lt: 100n, lte: 99n },
    };
    expect(() => validateListWhere(accountListFilter, where)).not.toThrow();
    expect(() => validateListWhere(assetListFilter, { scale: { gte: 0, lte: 18 } })).not.toThrow();
    expect(() =>
      validateListWhere(apiKeyListFilter, { role: { eq: 'SERVICE' }, revokedAt: { ne: null } }),
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
      expect(() => validateListWhere(accountListFilter, where)).toThrow(InvariantViolationError);
    expect(() => validateListWhere(assetListFilter, { scale: { eq: Infinity } })).toThrow(
      InvariantViolationError,
    );
    expect(() => validateListWhere(apiKeyListFilter, { keyHash: { eq: 'secret' } })).toThrow(
      InvariantViolationError,
    );
    expect(() =>
      validateListWhere(reconResultListFilter, { candidateTransactionIds: { in: [uuid] } }),
    ).toThrow(InvariantViolationError);
  });

  it('derives field types, enums and nullability from core models', () => {
    const account: WhereFor<typeof accountListFilter> = {
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
    const transaction: WhereFor<typeof transactionListFilter> = {
      id: { eq: uuid },
      ledgerId: { eq: uuid },
      description: { eq: null },
      relationType: { in: ['REVERSAL', 'CORRECTION'] },
      // @ts-expect-error Persisted timestamps are always present.
      createdAt: { eq: null },
    };
    const nested: WhereFor<typeof transactionListFilter> = {
      // @ts-expect-error Nested metadata is not filterable.
      metadata: { eq: {} },
    };
    const entry: WhereFor<typeof entryListFilter> = {
      accountId: { eq: uuid },
      signedAmountMinor: { lt: 0n },
      currency: { eq: 'USD' },
      // @ts-expect-error Persisted entry IDs are always present.
      id: { eq: null },
    };
    const apiKey: WhereFor<typeof apiKeyListFilter> = {
      revokedAt: { ne: null },
      // @ts-expect-error Private fields are not part of the public allowlist.
      keyHash: { eq: 'secret' },
    };
    const reconResult: WhereFor<typeof reconResultListFilter> = {
      runId: { eq: uuid },
      externalRecordId: { eq: null },
      externalId: { in: ['bank-1', 'bank-2'] },
      transactionId: { eq: null },
      status: { in: ['matched', 'unmatched_external'] },
      reason: { eq: 'matched' },
      createdAt: { gte: new Date(0) },
    };
    const invalidReconResult: WhereFor<typeof reconResultListFilter> = {
      // @ts-expect-error Candidate arrays are result data, not filterable fields.
      candidateTransactionIds: { in: [uuid] },
    };
    // Runtime checks intentionally do not repeat entity field-type validation.
    expect(() => validateListWhere(accountListFilter, { side: { eq: 'INVALID' } })).not.toThrow();
    expect([
      account,
      transaction,
      nested,
      entry,
      apiKey,
      reconResult,
      invalidReconResult,
    ]).toHaveLength(7);
  });

  it('binds pagination directly to the operation policy without a where alias', () => {
    const query: TransactionPaginationQuery = {
      tenantId: uuid,
      limit: 10,
      where: { reference: { eq: 'invoice' }, createdAt: { gte: new Date(0) } },
    };
    const unfiltered: PaginationQuery = {
      tenantId: uuid,
      limit: 10,
      // @ts-expect-error Operations without a policy do not accept filters.
      where: {},
    };
    const scoped: TransactionPaginationQuery = {
      tenantId: uuid,
      limit: 10,
      // @ts-expect-error Tenant scope is not a user filter.
      where: { tenantId: { eq: uuid } },
    };
    expect(() => validateListWhere(transactionListFilter, query.where)).not.toThrow();
    expect(() => validateListWhere(transactionListFilter, scoped.where)).toThrow(
      InvariantViolationError,
    );
    expect(unfiltered.limit).toBe(10);
  });

  it('takes list filter policies directly as the pagination generic', () => {
    const assetQuery: PaginationQuery<typeof assetListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: { code: { eq: 'USD' }, scale: { gte: 0 }, createdAt: { gte: new Date(0) } },
    };
    const accountQuery: PaginationQuery<typeof accountListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: { balanceMinor: { gte: 1n }, createdAt: { gte: new Date(0) } },
    };
    const namedAccountQuery: AccountPaginationQuery = accountQuery;
    const invalidUnknown: PaginationQuery<typeof assetListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: {
        // @ts-expect-error Unknown fields are excluded by the policy.
        unknownField: { eq: 'x' },
      },
    };
    const invalidTenant: PaginationQuery<typeof assetListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: {
        // @ts-expect-error Tenant scope cannot be selected by a filter.
        tenantId: { eq: uuid },
      },
    };
    const invalidArray: PaginationQuery<typeof reconResultListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: {
        // @ts-expect-error Candidate arrays are result data, not filterable fields.
        candidateTransactionIds: { in: [uuid] },
      },
    };
    const invalidPrivate: PaginationQuery<typeof apiKeyListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: {
        // @ts-expect-error Private API key fields are excluded by the policy.
        keyHash: { eq: 'private' },
      },
    };
    const invalidValue: PaginationQuery<typeof accountListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: {
        // @ts-expect-error Minor-unit amounts are bigint values.
        balanceMinor: { gte: 1 },
      },
    };
    const invalidOperator: PaginationQuery<typeof assetListFilter> = {
      tenantId: uuid,
      limit: 10,
      where: {
        // @ts-expect-error Scale is numeric and does not support text operators.
        scale: { contains: 2 },
      },
    };
    // @ts-expect-error The generic requires a policy, not a raw WhereFor object.
    type RawWherePagination = PaginationQuery<WhereFor<typeof assetListFilter>>;
    const acceptsRawWherePagination = (_query: RawWherePagination): void => {};
    expect([
      assetQuery,
      namedAccountQuery,
      invalidUnknown,
      invalidTenant,
      invalidArray,
      invalidPrivate,
      invalidValue,
      invalidOperator,
      acceptsRawWherePagination,
    ]).toHaveLength(9);
    expect(assetQuery.where?.code).toEqual({ eq: 'USD' });
    expect(accountQuery.where?.balanceMinor).toEqual({ gte: 1n });
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
      list: async (query: unknown) => {
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

  it('validates converted pagination services before repository access and scopes API keys to the actor', async () => {
    const calls: Array<{ resource: string; query: unknown }> = [];
    const page = { data: [], nextCursor: null };
    const actor = { tenantId: uuid, apiKeyId: uuid, role: ApiKeyRole.ADMIN };
    const ledgerService = new LedgerService({
      list: async (query: unknown) => {
        calls.push({ resource: 'ledgers', query });
        return page;
      },
    } as unknown as LedgerRepository);
    const assetService = new AssetService({
      list: async (query: unknown) => {
        calls.push({ resource: 'assets', query });
        return page;
      },
    } as unknown as AssetRepository);
    const reconciliationService = new ReconciliationService({
      listRules: async (query: unknown) => {
        calls.push({ resource: 'rules', query });
        return page;
      },
    } as unknown as ReconciliationApplicationRepository);
    const apiKeyService = new ApiKeyService({
      list: async (query: unknown) => {
        calls.push({ resource: 'api keys', query });
        return page;
      },
    } as unknown as ApiKeyRepository);
    const services: Array<{
      resource: string;
      call: (query: Record<string, unknown>) => Promise<unknown>;
      valid: Record<string, unknown>;
    }> = [
      {
        resource: 'ledgers',
        call: (query) => ledgerService.list(query as never),
        valid: { tenantId: uuid, limit: 10, where: { name: { eq: 'Main' } } },
      },
      {
        resource: 'assets',
        call: (query) => assetService.list(query as never),
        valid: { tenantId: uuid, limit: 10, where: { code: { eq: 'USD' } } },
      },
      {
        resource: 'rules',
        call: (query) => reconciliationService.listRules(query as never),
        valid: { tenantId: uuid, limit: 10, where: { name: { eq: 'Exact' } } },
      },
      {
        resource: 'api keys',
        call: (query) => apiKeyService.listApiKeys(actor, query as never),
        valid: { limit: 10, where: { role: { eq: 'SERVICE' } } },
      },
    ];

    for (const entry of services) {
      await entry.call(entry.valid);
      const expectedQuery =
        entry.resource === 'api keys' ? { ...entry.valid, tenantId: uuid } : entry.valid;
      expect(calls.at(-1)).toEqual({ resource: entry.resource, query: expectedQuery });
      const callCount = calls.length;
      const invalidQueries: Array<Record<string, unknown>> = [
        { ...entry.valid, limit: 0 },
        { ...entry.valid, limit: 201 },
        { ...entry.valid, limit: 1.5 },
        { ...entry.valid, cursor: ' ' },
        {
          ...entry.valid,
          where: { tenantId: { eq: uuid } },
        },
      ];
      if (entry.resource !== 'api keys') {
        invalidQueries.push({ ...entry.valid, tenantId: '' });
      }
      for (const query of invalidQueries) {
        await expect(entry.call(query)).rejects.toBeInstanceOf(InvariantViolationError);
      }
      expect(calls).toHaveLength(callCount);
    }

    await expect(
      apiKeyService.listApiKeys({ ...actor, tenantId: '' }, { limit: 10 }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
