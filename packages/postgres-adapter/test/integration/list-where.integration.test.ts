import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@luxledger/core/application';
import { sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import * as schema from '../../src/schema';
import { generateUuidV7 } from '../../src/uuid-v7';
import {
  createLedger,
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  createTenant,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const services = createApplicationServices(client);

async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<{ data: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

const replaceCursorTimestamp = (cursor: string, key: string, value: string): string => {
  const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  if ('values' in payload && typeof payload.values === 'object' && payload.values !== null) {
    (payload.values as Record<string, unknown>)[key] = value;
  } else {
    payload[key] = value;
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
};

async function fixture() {
  const tenantId = await createTenant(db, 'filters');
  const ledgerId = await createLedger(db, tenantId, 'Main');
  const wallet = await services.accounts.create({
    tenantId,
    ledgerId,
    name: 'Wallet',
    side: 'CREDIT',
    overdraftPolicy: 'DISALLOW',
    grantEnabled: true,
    currency: 'USD',
  });
  const funding = await services.accounts.create({
    tenantId,
    ledgerId,
    name: 'Funding',
    side: 'DEBIT',
    currency: 'USD',
  });
  for (const reference of ['skip', 'match-a', 'match-b']) {
    await services.creditGrants.create({
      tenantId,
      ledgerId,
      accountId: wallet.id,
      fundingAccountId: funding.id,
      reference,
      externalReference: reference === 'skip' ? 'skip' : 'match',
      amountMinor: 100n,
    });
  }
  return { tenantId, ledgerId, wallet, funding };
}

describe('service list where filters against PostgreSQL', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('filters accounts in SQL and cannot override tenant or fixed ledger scope', async () => {
    const { tenantId, ledgerId, wallet } = await fixture();
    const otherTenant = await createTenant(db, 'other');
    const otherLedger = await createLedger(db, tenantId, 'Other');
    expect(
      (
        await services.accounts.list({
          tenantId,
          limit: 1,
          where: { name: { eq: 'Funding' }, balanceMinor: { gte: 300n } },
        })
      ).data.map((a) => a.name),
    ).toEqual(['Funding']);
    expect(
      (
        await services.accounts.list({
          tenantId,
          ledgerId,
          limit: 10,
          where: { ledgerId: { eq: otherLedger } },
        })
      ).data,
    ).toEqual([]);
    expect(
      (
        await services.accounts.list({
          tenantId: otherTenant,
          limit: 10,
          where: { id: { eq: wallet.id } },
        })
      ).data,
    ).toEqual([]);
    expect(
      (
        await services.accounts.list({
          tenantId,
          limit: 10,
          where: { code: { eq: null }, grantEnabled: { eq: true } },
        })
      ).data.map((a) => a.id),
    ).toEqual([wallet.id]);
    expect(
      (await services.accounts.list({ tenantId, limit: 10, where: { code: { ne: null } } })).data,
    ).toEqual([]);
  });

  it('rejects unknown, excluded and persistence-only fields using policies and schema columns', async () => {
    const { tenantId, ledgerId } = await fixture();
    for (const field of ['unknownField', 'tenantId', 'reservedDeltaMinor', 'updatedAt']) {
      await expect(
        services.accounts.list({
          tenantId,
          limit: 10,
          where: { [field]: { eq: 0n } } as never,
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
    for (const field of ['unknownField', 'tenantId', 'metadata', 'entries', 'holdId']) {
      await expect(
        services.transactions.list({
          tenantId,
          limit: 10,
          where: { [field]: { eq: ledgerId } } as never,
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
    await expect(
      services.apiKeys.listApiKeys({ tenantId, apiKeyId: ledgerId, role: 'ADMIN' }, {
        keyHash: { eq: 'private' },
      } as never),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('filters transactions and entries before limit and binds cursors to filters', async () => {
    const { tenantId, ledgerId, funding } = await fixture();
    const wallet = await services.accounts.create({
      tenantId,
      ledgerId,
      name: 'Plain wallet',
      side: 'CREDIT',
      currency: 'USD',
    });
    for (const reference of ['skip-tx', 'match-a', 'match-b']) {
      await services.transactions.create({
        tenantId,
        ledgerId,
        reference,
        currency: 'USD',
        entries: [
          { accountId: funding.id, signedAmountMinor: 1n, currency: 'USD' },
          { accountId: wallet.id, signedAmountMinor: -1n, currency: 'USD' },
        ],
      });
    }
    const where = { reference: { in: ['match-a', 'match-b'] } };
    const page = await services.transactions.list({ tenantId, limit: 1, where });
    expect(page.data.map((t) => t.reference)).toEqual(['match-a']);
    expect(page.nextCursor).not.toBeNull();
    expect(
      (
        await services.transactions.list({
          tenantId,
          limit: 1,
          where,
          cursor: page.nextCursor ?? undefined,
        })
      ).data.map((t) => t.reference),
    ).toEqual(['match-b']);
    for (const changed of [undefined, { reference: { eq: 'skip' } }]) {
      await expect(
        services.transactions.list({
          tenantId,
          limit: 1,
          where: changed,
          cursor: page.nextCursor ?? undefined,
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
    const entries = await services.transactions.listEntries({
      tenantId,
      limit: 1,
      where: { accountId: { eq: wallet.id }, signedAmountMinor: { lt: 0n } },
    });
    expect(entries.data.map((e) => String(e.accountId))).toEqual([wallet.id]);
    await expect(
      services.transactions.listEntries({
        tenantId,
        limit: 1,
        cursor: entries.nextCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('filters grants/lots and rejects cursor reuse after changing the filter', async () => {
    const { tenantId, wallet } = await fixture();
    const where = { externalReference: { eq: 'match' } };
    const page = await services.creditGrants.list({ tenantId, limit: 1, where });
    expect(page.data.map((g) => g.reference)).toEqual(['match-a']);
    expect(
      (
        await services.creditGrants.list({
          tenantId,
          limit: 1,
          where,
          cursor: page.nextCursor ?? undefined,
        })
      ).data.map((g) => g.reference),
    ).toEqual(['match-b']);
    await expect(
      services.creditGrants.list({ tenantId, limit: 1, cursor: page.nextCursor ?? undefined }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    const lots = await services.creditGrants.listLots({
      tenantId,
      accountId: wallet.id,
      limit: 1,
      where,
    });
    expect(lots.data.map((g) => g.reference)).toEqual(['match-a']);
    expect(
      (
        await services.creditGrants.listLots({
          tenantId,
          accountId: wallet.id,
          limit: 1,
          where,
          cursor: lots.nextCursor ?? undefined,
        })
      ).data.map((g) => g.reference),
    ).toEqual(['match-b']);
    await expect(
      services.creditGrants.listLots({
        tenantId,
        accountId: wallet.id,
        limit: 1,
        cursor: lots.nextCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('filters balance history and binds filtered cursors to account, range and predicates', async () => {
    const { tenantId, wallet, funding } = await fixture();
    const query = {
      tenantId,
      accountId: wallet.id,
      from: new Date(0),
      to: new Date('2100-01-01'),
      limit: 1,
      where: { postedMinor: { lte: -200n } },
    };
    const page = await services.balances.listHistory(query);
    expect(page.data.map((e) => e.postedMinor)).toEqual([-200n]);
    expect(
      (
        await services.balances.listHistory({ ...query, cursor: page.nextCursor ?? undefined })
      ).data.map((e) => e.postedMinor),
    ).toEqual([-300n]);
    for (const changed of [
      { where: undefined },
      { accountId: funding.id },
      { to: new Date('2099-01-01') },
    ]) {
      await expect(
        services.balances.listHistory({
          ...query,
          ...changed,
          cursor: page.nextCursor ?? undefined,
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
    const unfiltered = await services.balances.listHistory({ ...query, where: undefined });
    await expect(
      services.balances.listHistory({ ...query, cursor: unfiltered.nextCursor ?? undefined }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('filters lineage through its joined transaction and grant columns', async () => {
    const { tenantId, wallet } = await fixture();
    const grants = await services.creditGrants.list({ tenantId, limit: 10 });
    const selected = grants.data[1];
    if (!selected) throw new Error('Fixture grant is missing');
    let transactionId = '';
    for (let index = 0; index < 3; index += 1) {
      const refund = await services.creditGrants.refund({
        tenantId,
        grantId: selected.id,
        reference: `refund-${index}-${selected.reference}`,
        amountMinor: 10n,
      });
      transactionId = refund.transactionId;
    }
    const where = { kind: { eq: 'REFUND' as const }, amountMinor: { eq: 10n } };
    const grantLineage = await services.creditGrants.listLineageByGrant({
      tenantId,
      grantId: selected.id,
      limit: 10,
      where,
    });
    expect(grantLineage.data).toHaveLength(3);
    const filtered = await services.creditGrants.listLineageByGrant({
      tenantId,
      grantId: selected.id,
      limit: 1,
      where,
    });
    expect(filtered.nextCursor).not.toBeNull();
    const paged = await collectPages((cursor) =>
      services.creditGrants.listLineageByGrant({
        tenantId,
        grantId: selected.id,
        limit: 1,
        where,
        cursor,
      }),
    );
    expect(paged.map(({ entryId }) => entryId)).toEqual(
      grantLineage.data.map(({ entryId }) => entryId),
    );
    expect(new Set(paged.map(({ entryId }) => entryId)).size).toBe(3);
    for (const changedWhere of [
      { kind: { eq: 'CONSUMPTION' as const }, amountMinor: { eq: 10n } },
      undefined,
    ]) {
      await expect(
        services.creditGrants.listLineageByGrant({
          tenantId,
          grantId: selected.id,
          limit: 1,
          where: changedWhere,
          cursor: filtered.nextCursor ?? undefined,
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
    expect(
      (
        await services.creditGrants.listLineageByTransaction({
          tenantId,
          transactionId,
          limit: 1,
          where: { grantId: { eq: selected.id }, createdAt: { gt: new Date(0) } },
        })
      ).data,
    ).toHaveLength(1);
    expect(
      (
        await services.creditGrants.listLineageByGrant({
          tenantId,
          grantId: selected.id,
          limit: 1,
          where: { kind: { eq: 'CONSUMPTION' } },
        })
      ).data,
    ).toEqual([]);
    expect(
      (
        await services.creditGrants.listLots({
          tenantId,
          accountId: wallet.id,
          limit: 10,
          where: { reference: { eq: 'absent' } },
        })
      ).data,
    ).toEqual([]);
  });

  it('preserves precise account, transaction and entry cursors and accepts legacy milliseconds', async () => {
    const { tenantId, ledgerId, wallet, funding } = await fixture();
    const assetId = wallet.assetId;
    if (!assetId) throw new Error('Fixture account must have an asset');
    const ids = [1, 2, 3].map((n) => `01900000-0000-7000-8000-00000000000${n}`);
    await client.runTenantTx(tenantId, 'seed precise list timestamps', async (tx) => {
      for (const [index, id] of ids.entries()) {
        // First row is exactly representable by legacy cursors; the others share
        // a microsecond timestamp, exercising both timestamp and ID ordering.
        const createdAt = sql`${index === 0 ? '2025-01-01T00:00:00.123000Z' : '2025-01-01T00:00:00.123001Z'}::timestamptz`;
        await tx.insert(schema.accounts).values({
          id,
          tenantId,
          ledgerId,
          name: 'Precise',
          side: 'DEBIT',
          currency: 'USD',
          assetId,
          createdAt,
        });
        await tx.insert(schema.transactions).values({
          id,
          tenantId,
          ledgerId,
          reference: `precise-${index}`,
          currency: 'USD',
          assetId,
          createdAt,
        });
        await tx.insert(schema.entries).values({
          id,
          tenantId,
          transactionId: id,
          accountId: id,
          signedAmountMinor: 1n,
          currency: 'USD',
          assetId,
          createdAt,
        });
        await tx.insert(schema.entries).values({
          tenantId,
          transactionId: id,
          accountId: funding.id,
          signedAmountMinor: -1n,
          currency: 'USD',
          assetId,
          createdAt,
        });
      }
    });
    const readers = [
      (cursor?: string) =>
        services.accounts.list({ tenantId, limit: 1, cursor, where: { id: { in: ids } } }),
      (cursor?: string) =>
        services.transactions.list({ tenantId, limit: 1, cursor, where: { id: { in: ids } } }),
      (cursor?: string) =>
        services.transactions.listEntries({
          tenantId,
          limit: 1,
          cursor,
          where: { id: { in: ids } },
        }),
    ];
    for (const read of readers) {
      let cursor: string | undefined;
      const seen: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const page = await read(cursor);
        seen.push(...page.data.map((row) => String(row.id)));
        cursor = page.nextCursor ?? undefined;
      }
      expect(seen).toEqual(ids);
      expect(cursor).toBeUndefined();
      const first = await read();
      const legacy = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString());
      legacy.values.created_at = '2025-01-01T00:00:00.123Z';
      const second = await read(Buffer.from(JSON.stringify(legacy)).toString('base64url'));
      expect(second.data.map((row) => String(row.id))).toEqual([ids[1]]);
      await expect(
        read(
          replaceCursorTimestamp(
            first.nextCursor as string,
            'created_at',
            '2025-02-31T00:00:00.123000Z',
          ),
        ),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
  });

  it('continues balance history across sub-millisecond timestamps without repeating rows', async () => {
    const { tenantId, ledgerId, wallet } = await fixture();
    const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7()];
    await client.runTenantTx(tenantId, 'seed precise history timestamps', async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.insert(schema.balanceSnapshots).values({
          id,
          tenantId,
          ledgerId,
          accountId: wallet.id,
          eventType: 'ADJUSTMENT',
          sourceId: id,
          postedMinor: BigInt(index),
          reservedDeltaMinor: 0n,
          effectiveAt: sql`${`2025-01-01T00:00:00.12300${index}Z`}::timestamptz`,
        });
      }
    });
    for (const where of [undefined, { eventType: { eq: 'ADJUSTMENT' as const } }]) {
      const query = {
        tenantId,
        accountId: wallet.id,
        limit: 1,
        where,
        from: new Date('2025-01-01'),
        to: new Date('2025-01-02'),
      };
      let cursor: string | undefined;
      const seen: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const page = await services.balances.listHistory({ ...query, cursor });
        seen.push(...page.data.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      }
      expect(seen).toEqual(ids);
      expect(cursor).toBeUndefined();
      const first = await services.balances.listHistory(query);
      const legacy = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString());
      legacy.effectiveAt = '2025-01-01T00:00:00.123Z';
      const second = await services.balances.listHistory({
        ...query,
        cursor: Buffer.from(JSON.stringify(legacy)).toString('base64url'),
      });
      expect(second.data.map((row) => row.id)).toEqual([ids[1]]);
      await expect(
        services.balances.listHistory({
          ...query,
          cursor: replaceCursorTimestamp(
            first.nextCursor as string,
            'effectiveAt',
            '2025-02-31T00:00:00.123000Z',
          ),
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
  });

  it('supports optional filters on legacy array-returning lists and retains authorization', async () => {
    const { tenantId, ledgerId } = await fixture();
    expect(
      (await services.assets.list(tenantId, { code: { eq: 'USD' }, scale: { eq: 2 } })).map(
        (a) => a.code,
      ),
    ).toEqual(['USD']);
    expect(await services.assets.list(tenantId, { code: { eq: "USD' OR true --" } })).toEqual([]);
    expect(
      (await services.ledgers.list(tenantId, { name: { eq: 'Main' } })).map((l) => l.id),
    ).toEqual([ledgerId]);
    const rule = await services.reconciliation.createRule({
      tenantId,
      name: 'Match',
      criteria: [{ field: 'reference', operator: 'equals' }],
    });
    expect(
      (await services.reconciliation.listRules(tenantId, { name: { eq: 'Match' } })).map(
        (r) => r.id,
      ),
    ).toEqual([rule.id]);
    expect(await services.reconciliation.listRules(tenantId, { name: { ne: 'Match' } })).toEqual(
      [],
    );
    const actor = { tenantId, apiKeyId: ledgerId, role: 'ADMIN' as const };
    await services.apiKeys.createApiKey(actor, { tenantId, name: 'Service', role: 'SERVICE' });
    expect(
      (
        await services.apiKeys.listApiKeys(actor, {
          role: { eq: 'SERVICE' },
          revokedAt: { eq: null },
        })
      ).map((k) => k.name),
    ).toEqual(['Service']);
    await expect(
      services.apiKeys.listApiKeys({ ...actor, role: 'SERVICE' }, { name: { eq: 'Service' } }),
    ).rejects.toThrow('Admin');
  });
});
