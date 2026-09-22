import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AccountSide, EntryDirection, InvalidCreditGrantError } from '@luxledger/core';
import { CreditGrantConflictError, CreditGrantNotFoundError } from '@luxledger/core/application';
import { eq, sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import { createDbClient } from '../../src/client';
import {
  accounts as accountRows,
  creditGrantEntries,
  creditGrants,
  entries,
  transactions,
} from '../../src/schema';
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
      ['PURCHASED', 100n],
      ['PROMOTIONAL', 100n],
    ]);
    expect(balance.originTotals.map((bucket) => [bucket.origin, bucket.remainingMinor])).toEqual([
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
      services.creditGrants.create({
        ...input,
        reference: 'foreign-funding',
        fundingAccountId: other.fundingAccountId,
      }),
    ).rejects.toThrow();
    const anotherLedger = await setup(tenantId);
    await expect(
      services.creditGrants.create({
        ...input,
        reference: 'another-ledger-funding',
        fundingAccountId: anotherLedger.fundingAccountId,
      }),
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
    await expect(
      services.creditGrants.create({
        ...purchased,
        policy: { ...purchased.policy, eligibility: 'region=EU' },
      }),
    ).rejects.toBeInstanceOf(InvalidCreditGrantError);
    const result = await services.creditGrants.create(purchased);
    await expect(
      (async () => {
        await db
          .update(creditGrants)
          .set({ origin: 'TRIAL' })
          .where(eq(creditGrants.id, result.grant.id));
      })(),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });

  it('retains one bucket per grant across origins and policy differences', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const origins = ['PURCHASED', 'PROMOTIONAL', 'TRIAL', 'COMPENSATION'] as const;
    for (const [index, origin] of origins.entries()) {
      await services.creditGrants.create({
        ...grantInput(
          tenantId,
          accounts,
          origin === 'PROMOTIONAL' ? origin : 'PURCHASED',
          `origin-${index}`,
        ),
        origin,
        policy: {
          refundable: origin === 'PURCHASED',
          transferable: false,
          consumptionPriority: index,
          eligibility: null,
        },
      });
    }
    await services.creditGrants.create({
      ...grantInput(tenantId, accounts, 'PURCHASED', 'another-purchased'),
      policy: { refundable: true, transferable: true, consumptionPriority: 99, eligibility: null },
    });
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.buckets).toHaveLength(5);
    expect(balance.buckets.map((bucket) => bucket.grantId)).toEqual([
      ...new Set(balance.buckets.map((bucket) => bucket.grantId)),
    ]);
    expect(
      balance.buckets
        .filter((bucket) => bucket.origin === 'PURCHASED')
        .map((bucket) => bucket.policy.consumptionPriority),
    ).toEqual([0, 99]);
    expect(balance.originTotals.find((total) => total.origin === 'PURCHASED')?.remainingMinor).toBe(
      200n,
    );
    expect(balance.remainingMinor).toBe(balance.ledgerBalanceMinor);
  });

  it('allows only one of two concurrent reversal references', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'PURCHASED', 'buy-1'),
    );
    const secondClient = createDbClient({
      databaseUrl:
        process.env.DATABASE_URL_TEST ??
        'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test',
      max: 2,
    });
    try {
      const other = createApplicationServices(secondClient);
      const results = await Promise.allSettled([
        services.creditGrants.reverse({ tenantId, grantId: grant.grant.id, reference: 'refund-a' }),
        other.creditGrants.reverse({ tenantId, grantId: grant.grant.id, reference: 'refund-b' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
        CreditGrantConflictError,
      );
      expect(
        (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
      ).toBe(0n);
    } finally {
      await secondClient.sql.end({ timeout: 5 });
    }
  });

  it('detects a tampered ledger amount during aggregate reconciliation', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'PURCHASED', 'buy-1'),
    );
    await expect(
      (async () => {
        await db
          .update(entries)
          .set({ amountMinor: 101n })
          .where(eq(entries.transactionId, grant.grant.transactionId));
      })(),
    ).rejects.toThrow();
    await expect(
      (async () => {
        await db
          .update(transactions)
          .set({ reference: 'tampered' })
          .where(eq(transactions.id, grant.grant.transactionId));
      })(),
    ).rejects.toThrow();
    await db
      .update(accountRows)
      .set({ balanceMinor: 101n })
      .where(eq(accountRows.id, accounts.accountId));
    await expect(
      services.creditGrants.getBalance(tenantId, accounts.accountId),
    ).rejects.toBeInstanceOf(CreditGrantConflictError);
  });

  it('enforces tenant and ledger scope in PostgreSQL foreign keys', async () => {
    const tenantId = await createTenant(db, 'A');
    const otherTenantId = await createTenant(db, 'B');
    const accounts = await setup(tenantId);
    const anotherLedger = await setup(tenantId);
    const otherTenant = await setup(otherTenantId);
    const posting = await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'unclassified-before-grants',
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
    });
    const row = {
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.accountId,
      fundingAccountId: accounts.fundingAccountId,
      assetId: accounts.assetId,
      reference: 'direct-invalid',
      origin: 'PURCHASED' as const,
      refundable: true,
      transferable: false,
      consumptionPriority: 0,
      eligibility: null,
      transactionId: posting.transactionId,
    };
    for (const [suffix, override] of [
      ['other-ledger-account', { fundingAccountId: anotherLedger.fundingAccountId }],
      ['other-tenant-account', { fundingAccountId: otherTenant.fundingAccountId }],
      ['other-ledger', { ledgerId: anotherLedger.ledgerId }],
    ] as const) {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          await tx.insert(creditGrants).values({ ...row, ...override, reference: suffix });
        }),
      ).rejects.toThrow();
    }
  });

  it('rejects a funding account with a different asset despite the same legacy currency', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const otherAsset = await services.assets.create({ tenantId, code: 'USDC', scale: 6 });
    const [funding] = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return tx
        .insert(accountRows)
        .values({
          tenantId,
          ledgerId: accounts.ledgerId,
          name: 'Legacy currency mismatch',
          side: 'DEBIT',
          currency: 'USD',
          assetId: otherAsset.id,
        })
        .returning({ id: accountRows.id });
    });
    await expect(
      services.creditGrants.create({
        ...grantInput(tenantId, accounts, 'PURCHASED', 'wrong-funding-asset'),
        fundingAccountId: funding.id,
      }),
    ).rejects.toThrow();
  });

  it('reconciles a wallet with many grants', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const input = grantInput(tenantId, accounts, 'PURCHASED', 'batch-0');
    for (let index = 0; index < 200; index++) {
      await services.creditGrants.create({ ...input, reference: `batch-${index}` });
    }
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.buckets).toHaveLength(200);
    expect(balance.remainingMinor).toBe(20000n);
    expect(balance.ledgerBalanceMinor).toBe(balance.remainingMinor);
  }, 30000);

  it('enforces wallet adoption and entry attribution at the PostgreSQL boundary', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'PURCHASED', 'buy-1'),
    );
    const [wallet] = await db
      .select({ kind: accountRows.kind })
      .from(accountRows)
      .where(eq(accountRows.id, accounts.accountId));
    expect(wallet.kind).toBe('CREDIT_WALLET');
    await expect(
      (async () => {
        await db
          .update(accountRows)
          .set({ kind: 'STANDARD' })
          .where(eq(accountRows.id, accounts.accountId));
      })(),
    ).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        await tx.insert(entries).values({
          tenantId,
          transactionId: grant.grant.transactionId,
          accountId: accounts.accountId,
          direction: 'CREDIT',
          amountMinor: 1n,
          currency: 'USD',
          assetId: accounts.assetId,
        });
      }),
    ).rejects.toThrow();
    const [link] = await db
      .select()
      .from(creditGrantEntries)
      .where(eq(creditGrantEntries.grantId, grant.grant.id));
    expect(link).toBeDefined();
    await expect(
      (async () => {
        await db
          .update(creditGrantEntries)
          .set({ entryId: link.entryId })
          .where(eq(creditGrantEntries.entryId, link.entryId));
      })(),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });

  it('does not adopt a zero-balance account with prior ledger history', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const posted = await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'old-posting',
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
    });
    await services.transactions.reverse({
      tenantId,
      transactionId: posted.transactionId,
      reference: 'old-posting-reversal',
    });
    await expect(
      services.creditGrants.create(grantInput(tenantId, accounts, 'PURCHASED', 'late-adoption')),
    ).rejects.toBeInstanceOf(CreditGrantConflictError);
  });
});
