import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AccountSide } from '@luxledger/core';
import { AccountNotFoundError, InvariantViolationError } from '@luxledger/core/application';
import { eq, sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import { creditGrants } from '../../src/schema';
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

const setup = async (tenantId: string) => {
  const ledgerId = await createLedger(db, tenantId, 'Credits');
  const asset = (await services.assets.list(tenantId)).find((item) => item.code === 'USD');
  if (!asset) throw new Error('Missing test asset');
  const wallet = await services.accounts.create({
    tenantId,
    ledgerId,
    name: 'Wallet',
    side: AccountSide.CREDIT,
    overdraftPolicy: 'DISALLOW',
    grantEnabled: true,
    currency: 'USD',
    assetId: asset.id,
  });
  const funding = await services.accounts.create({
    tenantId,
    ledgerId,
    name: 'Funding',
    side: AccountSide.DEBIT,
    currency: 'USD',
    assetId: asset.id,
  });
  return { ledgerId, accountId: wallet.id, fundingAccountId: funding.id };
};

type Accounts = Awaited<ReturnType<typeof setup>>;

const grant = (
  tenantId: string,
  accounts: Accounts,
  reference: string,
  externalReference?: string,
) =>
  services.creditGrants.create({
    tenantId,
    ledgerId: accounts.ledgerId,
    accountId: accounts.accountId,
    fundingAccountId: accounts.fundingAccountId,
    reference,
    externalReference,
    amountMinor: 100n,
  });

const collect = async <T>(
  fetchPage: (cursor?: string) => Promise<{ data: T[]; nextCursor: string | null }>,
  pageSizeCheck?: number,
) => {
  const items: T[] = [];
  let pages = 0;
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    if (pageSizeCheck !== undefined) expect(page.data.length).toBeLessThanOrEqual(pageSizeCheck);
    items.push(...page.data);
    cursor = page.nextCursor ?? undefined;
    pages += 1;
  } while (cursor !== undefined);
  return { items, pages };
};

describe('bounded credit grant queries', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('returns empty pages and a zero summary for an account without grants', async () => {
    const tenantId = await createTenant(db, 'empty');
    const accounts = await setup(tenantId);
    expect(await services.creditGrants.list({ tenantId, limit: 10 })).toEqual({
      data: [],
      nextCursor: null,
    });
    expect(
      await services.creditGrants.listLots({ tenantId, accountId: accounts.accountId, limit: 10 }),
    ).toEqual({ data: [], nextCursor: null });
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.remainingMinor).toBe(0n);
    expect(balance.ledgerBalanceMinor).toBe(0n);
    expect('lots' in balance).toBe(false);
  });

  it('pages grants and lots in a stable order without gaps or duplicates', async () => {
    const tenantId = await createTenant(db, 'history');
    const accounts = await setup(tenantId);
    const created = [];
    for (let index = 0; index < 7; index += 1) {
      created.push((await grant(tenantId, accounts, `grant-${index}`)).grant.id);
    }

    const grants = await collect(
      (cursor) => services.creditGrants.list({ tenantId, limit: 3, cursor }),
      3,
    );
    expect(grants.pages).toBe(3);
    expect(new Set(grants.items.map((item) => item.id)).size).toBe(7);
    expect(grants.items.map((item) => item.id).sort()).toEqual([...created].sort());

    const lots = await collect(
      (cursor) =>
        services.creditGrants.listLots({
          tenantId,
          accountId: accounts.accountId,
          limit: 2,
          cursor,
        }),
      2,
    );
    expect(lots.items.map((lot) => lot.grantId)).toEqual(grants.items.map((item) => item.id));

    const again = await collect((cursor) =>
      services.creditGrants.list({ tenantId, limit: 4, cursor }),
    );
    expect(again.items.map((item) => item.id)).toEqual(grants.items.map((item) => item.id));
  });

  it('breaks created_at ties by id and survives concurrent inserts between pages', async () => {
    const tenantId = await createTenant(db, 'ties');
    const accounts = await setup(tenantId);
    for (let index = 0; index < 4; index += 1) await grant(tenantId, accounts, `tie-${index}`);
    // Test-only: history is immutable, so lift the guard briefly to force identical timestamps.
    await db.execute(sql`alter table credit_grants disable trigger user`);
    try {
      await db
        .update(creditGrants)
        .set({ createdAt: new Date('2026-01-01T00:00:00.123Z') })
        .where(eq(creditGrants.tenantId, tenantId));
    } finally {
      await db.execute(sql`alter table credit_grants enable trigger user`);
    }

    const first = await services.creditGrants.list({ tenantId, limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const late = await grant(tenantId, accounts, 'late-insert');
    const rest = await collect(
      (cursor) =>
        services.creditGrants.list({
          tenantId,
          limit: 2,
          cursor: cursor ?? (first.nextCursor as string),
        }),
      2,
    );
    const seen = [...first.data, ...rest.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(late.grant.id);
    expect(seen).toHaveLength(5);
    expect(first.data.map((item) => item.id)).toEqual(
      [...first.data.map((item) => item.id)].sort(),
    );
  });

  it('rejects invalid limits and cursors with application errors', async () => {
    const tenantId = await createTenant(db, 'invalid');
    const accounts = await setup(tenantId);
    for (const limit of [0, -1, 201, 1.5, Number.NaN]) {
      await expect(services.creditGrants.list({ tenantId, limit })).rejects.toBeInstanceOf(
        InvariantViolationError,
      );
    }
    const badCursors = [
      '',
      'not-base64-json',
      Buffer.from('[]').toString('base64url'),
      Buffer.from('{"created_at":"nope","id":"x"}').toString('base64url'),
      Buffer.from('{"created_at":"2026-01-01T00:00:00.000Z","id":"not-a-uuid"}').toString(
        'base64url',
      ),
    ];
    for (const cursor of badCursors) {
      await expect(
        services.creditGrants.list({ tenantId, limit: 10, cursor }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
      await expect(
        services.creditGrants.listLots({
          tenantId,
          accountId: accounts.accountId,
          limit: 10,
          cursor,
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    }
  });

  it('keeps the summary reconciled with the paged lots', async () => {
    const tenantId = await createTenant(db, 'summary');
    const accounts = await setup(tenantId);
    for (let index = 0; index < 5; index += 1) await grant(tenantId, accounts, `sum-${index}`);
    await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'spend-1',
      currency: 'USD',
      entries: [
        { accountId: accounts.accountId, signedAmountMinor: 250n, currency: 'USD' },
        { accountId: accounts.fundingAccountId, signedAmountMinor: -250n, currency: 'USD' },
      ],
    });
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    const lots = await collect((cursor) =>
      services.creditGrants.listLots({ tenantId, accountId: accounts.accountId, limit: 2, cursor }),
    );
    const total = lots.items.reduce((sum, lot) => sum + lot.remainingMinor, 0n);
    expect(balance.remainingMinor).toBe(250n);
    expect(balance.ledgerBalanceMinor).toBe(250n);
    expect(total).toBe(balance.remainingMinor);
  });

  it('pages lineage by transaction and by grant with stable ordering', async () => {
    const tenantId = await createTenant(db, 'lineage');
    const accounts = await setup(tenantId);
    const grants: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      grants.push((await grant(tenantId, accounts, `lin-${index}`)).grant.id);
    }
    const spend = await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'spend-all',
      currency: 'USD',
      entries: [
        { accountId: accounts.accountId, signedAmountMinor: 300n, currency: 'USD' },
        { accountId: accounts.fundingAccountId, signedAmountMinor: -300n, currency: 'USD' },
      ],
    });
    const full = await collect((cursor) =>
      services.creditGrants.listLineageByTransaction({
        tenantId,
        transactionId: spend.transactionId,
        limit: 200,
        cursor,
      }),
    );
    const paged = await collect(
      (cursor) =>
        services.creditGrants.listLineageByTransaction({
          tenantId,
          transactionId: spend.transactionId,
          limit: 1,
          cursor,
        }),
      1,
    );
    expect(full.items).toHaveLength(3);
    expect(paged.pages).toBe(3);
    expect(paged.items).toEqual(full.items);
    const byGrant = await collect((cursor) =>
      services.creditGrants.listLineageByGrant({ tenantId, grantId: grants[0], limit: 1, cursor }),
    );
    expect(byGrant.items.map((item) => item.grantId)).toEqual([grants[0]]);
  });

  it('recovers grants by tenant reference and external reference', async () => {
    const tenantId = await createTenant(db, 'reference');
    const accounts = await setup(tenantId);
    const target = await grant(tenantId, accounts, 'order-42', 'ext-1');
    await grant(tenantId, accounts, 'order-43', 'ext-1');
    await grant(tenantId, accounts, 'order-44');

    const byReference = await services.creditGrants.list({
      tenantId,
      limit: 10,
      reference: 'order-42',
    });
    expect(byReference.data.map((item) => item.id)).toEqual([target.grant.id]);
    expect(
      (await services.creditGrants.list({ tenantId, limit: 10, reference: 'missing' })).data,
    ).toEqual([]);
    expect(
      (await services.creditGrants.list({ tenantId, limit: 10, externalReference: 'ext-1' })).data,
    ).toHaveLength(2);
    expect(
      (
        await services.creditGrants.list({
          tenantId,
          limit: 10,
          accountId: accounts.accountId,
          reference: 'order-44',
        })
      ).data,
    ).toHaveLength(1);
    await expect(
      services.creditGrants.list({ tenantId, limit: 10, reference: ' ' }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('isolates tenants across list, lot, and lineage reads', async () => {
    const tenantA = await createTenant(db, 'tenant-a');
    const tenantB = await createTenant(db, 'tenant-b');
    const accountsA = await setup(tenantA);
    const accountsB = await setup(tenantB);
    const grantA = await grant(tenantA, accountsA, 'shared-reference');
    await grant(tenantB, accountsB, 'shared-reference');

    const listedB = await services.creditGrants.list({
      tenantId: tenantB,
      limit: 10,
      reference: 'shared-reference',
    });
    expect(listedB.data).toHaveLength(1);
    expect(listedB.data[0]?.id).not.toBe(grantA.grant.id);
    expect(
      (await services.creditGrants.list({ tenantId: tenantB, limit: 10 })).data.map(
        (item) => item.tenantId,
      ),
    ).toEqual([tenantB]);
    await expect(
      services.creditGrants.listLots({
        tenantId: tenantB,
        accountId: accountsA.accountId,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
    expect(
      (
        await services.creditGrants.listLineageByGrant({
          tenantId: tenantB,
          grantId: grantA.grant.id,
          limit: 10,
        })
      ).data,
    ).toEqual([]);
  });
});
