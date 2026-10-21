import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@luxledger/core/application';
import { createApplicationServices } from '../../src/application-services';
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
    for (const grant of grants.data) {
      await services.creditGrants.refund({
        tenantId,
        grantId: grant.id,
        reference: `refund-${grant.reference}`,
        amountMinor: 10n,
      });
    }
    const selected = grants.data[1];
    const grantLineage = await services.creditGrants.listLineageByGrant({
      tenantId,
      grantId: selected.id,
      limit: 1,
      where: { kind: { eq: 'REFUND' }, amountMinor: { eq: 10n } },
    });
    expect(grantLineage.data).toHaveLength(1);
    const transactionId = grantLineage.data[0].transactionId;
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
