import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AccountSide, EntryDirection, InvalidCreditGrantError } from '@luxledger/core';
import { CreditGrantConflictError, CreditGrantNotFoundError } from '@luxledger/core/application';
import { eq } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import { createDbClient } from '../../src/client';
import { creditGrants, entries } from '../../src/schema';
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
  return { ledgerId, assetId: asset.id, accountId: wallet.id, fundingAccountId: funding.id };
};

const grantInput = (
  tenantId: string,
  setupResult: Awaited<ReturnType<typeof setup>>,
  origin: 'PURCHASED' | 'PROMOTIONAL',
  reference: string,
) => ({
  tenantId,
  ...setupResult,
  reference,
  origin,
  amountMinor: 100n,
  externalReference: 'business-order-1',
  policy: {
    refundable: origin === 'PURCHASED',
    transferable: false,
    consumptionPriority: origin === 'PROMOTIONAL' ? 1 : 2,
    eligibility: null,
  },
});

describe('credit grants', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('posts purchased and promotional grants and reconciles exact bucket and ledger entries', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const purchased = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'PURCHASED', 'buy-1'),
    );
    const promotional = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'PROMOTIONAL', 'promo-1'),
    );
    expect(purchased.created).toBeTrue();
    expect(promotional.created).toBeTrue();
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.ledgerBalanceMinor).toBe(200n);
    expect(balance.remainingMinor).toBe(200n);
    expect(balance.buckets.map((bucket) => [bucket.origin, bucket.remainingMinor])).toEqual([
      ['PROMOTIONAL', 100n],
      ['PURCHASED', 100n],
    ]);
    const posted = await db
      .select()
      .from(entries)
      .where(eq(entries.transactionId, purchased.grant.transactionId));
    expect(posted).toHaveLength(2);
    expect(posted.find((entry) => entry.accountId === accounts.accountId)?.direction).toBe(
      EntryDirection.CREDIT,
    );
    expect(posted.find((entry) => entry.accountId === accounts.fundingAccountId)?.direction).toBe(
      EntryDirection.DEBIT,
    );
    expect(
      posted.every((entry) => entry.assetId === accounts.assetId && entry.amountMinor === 100n),
    ).toBeTrue();
  });

  it('accepts identical retry, rejects conflicts and foreign tenant or asset access', async () => {
    const tenantId = await createTenant(db, 'A');
    const otherTenantId = await createTenant(db, 'B');
    const accounts = await setup(tenantId);
    const other = await setup(otherTenantId);
    const input = grantInput(tenantId, accounts, 'PURCHASED', 'buy-1');
    const first = await services.creditGrants.create(input);
    const retry = await services.creditGrants.create(input);
    expect(retry.created).toBeFalse();
    expect(retry.grant.id).toBe(first.grant.id);
    await expect(
      services.creditGrants.create({ ...input, amountMinor: 101n }),
    ).rejects.toBeInstanceOf(CreditGrantConflictError);
    await expect(
      services.creditGrants.create({ ...input, policy: { ...input.policy, transferable: true } }),
    ).rejects.toBeInstanceOf(CreditGrantConflictError);
    await expect(
      services.creditGrants.getById(otherTenantId, first.grant.id),
    ).rejects.toBeInstanceOf(CreditGrantNotFoundError);
    await expect(
      services.creditGrants.create({ ...input, reference: 'foreign', accountId: other.accountId }),
    ).rejects.toThrow();
    await expect(
      services.creditGrants.create({ ...input, reference: 'wrong-asset', assetId: other.assetId }),
    ).rejects.toThrow();
  });

  it('serializes concurrent duplicate grants and records one full compensation', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const input = grantInput(tenantId, accounts, 'PURCHASED', 'concurrent');
    const secondClient = createDbClient({
      databaseUrl:
        process.env.DATABASE_URL_TEST ??
        'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test',
      max: 2,
    });
    try {
      const other = createApplicationServices(secondClient);
      const [a, b] = await Promise.all([
        services.creditGrants.create(input),
        other.creditGrants.create(input),
      ]);
      expect(a.grant.id).toBe(b.grant.id);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      const conflicting = await Promise.allSettled([
        services.creditGrants.create({ ...input, reference: 'conflicting-concurrent' }),
        other.creditGrants.create({
          ...input,
          reference: 'conflicting-concurrent',
          amountMinor: 101n,
        }),
      ]);
      expect(conflicting.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(conflicting.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(conflicting.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
        CreditGrantConflictError,
      );
      const accepted = conflicting.find((result) => result.status === 'fulfilled');
      if (!accepted) throw new Error('Expected one successful concurrent grant');
      const different = await Promise.all([
        services.creditGrants.create({ ...input, reference: 'simultaneous-a' }),
        other.creditGrants.create({ ...input, reference: 'simultaneous-b' }),
      ]);
      expect(different.every((item) => item.created)).toBeTrue();
      const reversed = await services.creditGrants.reverse({
        tenantId,
        grantId: a.grant.id,
        reference: 'reverse-1',
      });
      expect(reversed.created).toBeTrue();
      expect(reversed.grant.reversedByTransactionId).not.toBeNull();
      expect(
        (
          await services.creditGrants.reverse({
            tenantId,
            grantId: a.grant.id,
            reference: 'reverse-1',
          })
        ).created,
      ).toBeFalse();
      await expect(
        services.creditGrants.reverse({ tenantId, grantId: a.grant.id, reference: 'reverse-2' }),
      ).rejects.toBeInstanceOf(CreditGrantConflictError);
      const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
      expect(balance.ledgerBalanceMinor).toBe(200n + accepted.value.grant.amountMinor);
      expect(balance.buckets.find((bucket) => bucket.origin === 'PURCHASED')?.reversedMinor).toBe(
        100n,
      );
    } finally {
      await secondClient.sql.end({ timeout: 5 });
    }
  });

  it('rejects an untracked ledger posting and preserves the reconciled balance', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    await services.creditGrants.create(grantInput(tenantId, accounts, 'PROMOTIONAL', 'promo-1'));
    await expect(
      services.transactions.create({
        tenantId,
        ledgerId: accounts.ledgerId,
        reference: 'untracked',
        currency: 'USD',
        entries: [
          {
            accountId: accounts.fundingAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 1n,
            currency: 'USD',
          },
          {
            accountId: accounts.accountId,
            direction: EntryDirection.CREDIT,
            amountMinor: 1n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });

  it('enforces purchased and promotional policy and immutable grant history', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const purchased = grantInput(tenantId, accounts, 'PURCHASED', 'buy-1');
    await expect(
      services.creditGrants.create({
        ...purchased,
        policy: { ...purchased.policy, refundable: false },
      }),
    ).rejects.toBeInstanceOf(InvalidCreditGrantError);
    const promotional = grantInput(tenantId, accounts, 'PROMOTIONAL', 'promo-1');
    await expect(
      services.creditGrants.create({
        ...promotional,
        policy: { ...promotional.policy, transferable: true },
      }),
    ).rejects.toBeInstanceOf(InvalidCreditGrantError);
    await expect(
      services.creditGrants.create({ ...purchased, amountMinor: -1n }),
    ).rejects.toBeInstanceOf(InvalidCreditGrantError);
    const result = await services.creditGrants.create(purchased);
    await expect(
      (async () => {
        await db
          .update(creditGrants)
          .set({ amountMinor: 999n })
          .where(eq(creditGrants.id, result.grant.id));
      })(),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });
});
