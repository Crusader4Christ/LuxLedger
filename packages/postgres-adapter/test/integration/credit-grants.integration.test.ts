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
  reference: string,
) => ({
  tenantId,
  ledgerId: setupResult.ledgerId,
  accountId: setupResult.accountId,
  fundingAccountId: setupResult.fundingAccountId,
  reference,
  amountMinor: 100n,
  externalReference: 'business-order-1',
});

const consume = (
  tenantId: string,
  setupResult: Awaited<ReturnType<typeof setup>>,
  reference: string,
  amountMinor: bigint,
) =>
  services.transactions.create({
    tenantId,
    ledgerId: setupResult.ledgerId,
    reference,
    currency: 'USD',
    entries: [
      {
        accountId: setupResult.accountId,
        direction: EntryDirection.DEBIT,
        amountMinor,
        currency: 'USD',
      },
      {
        accountId: setupResult.fundingAccountId,
        direction: EntryDirection.CREDIT,
        amountMinor,
        currency: 'USD',
      },
    ],
  });

const consumeInTwoEntries = (
  tenantId: string,
  setupResult: Awaited<ReturnType<typeof setup>>,
  reference: string,
) =>
  services.transactions.create({
    tenantId,
    ledgerId: setupResult.ledgerId,
    reference,
    currency: 'USD',
    entries: [
      {
        accountId: setupResult.accountId,
        direction: EntryDirection.DEBIT,
        amountMinor: 80n,
        currency: 'USD',
      },
      {
        accountId: setupResult.accountId,
        direction: EntryDirection.DEBIT,
        amountMinor: 80n,
        currency: 'USD',
      },
      {
        accountId: setupResult.fundingAccountId,
        direction: EntryDirection.CREDIT,
        amountMinor: 160n,
        currency: 'USD',
      },
    ],
  });

const lineageTotalsByGrant = (
  lineage: Awaited<ReturnType<typeof services.creditGrants.listLineageByTransaction>>,
) => {
  const totals = new Map<string, bigint>();
  for (const allocation of lineage) {
    totals.set(allocation.grantId, (totals.get(allocation.grantId) ?? 0n) + allocation.amountMinor);
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
};

describe('credit grants', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('posts grants and reconciles exact lot and ledger entries', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const purchased = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
    const promotional = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'grant-2'),
    );
    expect(purchased.created).toBeTrue();
    expect(promotional.created).toBeTrue();
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.ledgerBalanceMinor).toBe(200n);
    expect(balance.remainingMinor).toBe(200n);
    expect(balance.lots.map((lot) => lot.remainingMinor)).toEqual([100n, 100n]);
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

  it('allocates consumption deterministically across grants and exposes both audit directions', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const first = await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    const second = await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-2'));

    const consumed = await consume(tenantId, accounts, 'consume-150', 150n);
    const transactionLineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      consumed.transactionId,
    );
    expect(
      transactionLineage.map(({ grantId, amountMinor, kind }) => ({ grantId, amountMinor, kind })),
    ).toEqual([
      { grantId: first.grant.id, amountMinor: 100n, kind: 'CONSUMPTION' },
      { grantId: second.grant.id, amountMinor: 50n, kind: 'CONSUMPTION' },
    ]);
    expect(await services.creditGrants.listLineageByGrant(tenantId, first.grant.id)).toHaveLength(
      1,
    );
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.remainingMinor).toBe(50n);
    expect(balance.lots.map((lot) => [lot.consumedMinor, lot.remainingMinor])).toEqual([
      [100n, 0n],
      [50n, 50n],
    ]);

    const retry = await consume(tenantId, accounts, 'consume-150', 150n);
    expect(retry).toEqual({ transactionId: consumed.transactionId, created: false });
    await expect(consume(tenantId, accounts, 'consume-150', 149n)).rejects.toThrow(
      'reference payload mismatch',
    );
  });

  it('allocates multiple debit entries from one in-memory capacity projection', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const first = await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    const second = await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-2'));

    const consumed = await consumeInTwoEntries(tenantId, accounts, 'consume-split-projection');
    const lineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      consumed.transactionId,
    );
    const entryIds = [...new Set(lineage.map((allocation) => allocation.entryId))];

    expect(entryIds).toHaveLength(2);
    expect(
      lineage.map(({ entryId, grantId, amountMinor }) => ({ entryId, grantId, amountMinor })),
    ).toEqual([
      { entryId: entryIds[0], grantId: first.grant.id, amountMinor: 80n },
      { entryId: entryIds[1], grantId: first.grant.id, amountMinor: 20n },
      { entryId: entryIds[1], grantId: second.grant.id, amountMinor: 60n },
    ]);
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(40n);
  });

  it('allocates each grant-enabled account independently in one transaction', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const secondAccount = await services.accounts.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      name: 'Second wallet',
      side: AccountSide.CREDIT,
      overdraftPolicy: 'DISALLOW',
      currency: 'USD',
      assetId: accounts.assetId,
    });
    const firstGrant = await services.creditGrants.create(
      grantInput(tenantId, accounts, 'first-account-grant'),
    );
    const secondGrant = await services.creditGrants.create({
      ...grantInput(tenantId, accounts, 'second-account-grant'),
      accountId: secondAccount.id,
    });

    const consumed = await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'consume-two-accounts',
      currency: 'USD',
      entries: [
        {
          accountId: accounts.accountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 40n,
          currency: 'USD',
        },
        {
          accountId: secondAccount.id,
          direction: EntryDirection.DEBIT,
          amountMinor: 60n,
          currency: 'USD',
        },
        {
          accountId: accounts.fundingAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 100n,
          currency: 'USD',
        },
      ],
    });

    const lineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      consumed.transactionId,
    );
    expect(lineage).toHaveLength(2);
    expect(lineage.map(({ grantId, amountMinor }) => ({ grantId, amountMinor }))).toEqual(
      expect.arrayContaining([
        { grantId: firstGrant.grant.id, amountMinor: 40n },
        { grantId: secondGrant.grant.id, amountMinor: 60n },
      ]),
    );
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(60n);
    expect(
      (await services.creditGrants.getBalance(tenantId, secondAccount.id)).remainingMinor,
    ).toBe(40n);
  });

  it('rolls back insufficient and concurrent consumption without double allocation', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    await expect(
      services.transactions.create({
        tenantId,
        ledgerId: accounts.ledgerId,
        reference: 'cumulative-too-much',
        currency: 'USD',
        entries: [
          {
            accountId: accounts.accountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 60n,
            currency: 'USD',
          },
          {
            accountId: accounts.accountId,
            direction: EntryDirection.DEBIT,
            amountMinor: 50n,
            currency: 'USD',
          },
          {
            accountId: accounts.fundingAccountId,
            direction: EntryDirection.CREDIT,
            amountMinor: 110n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toThrow('insufficient credit grant capacity');
    expect(
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.reference, 'cumulative-too-much')),
    ).toHaveLength(0);
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);

    const secondClient = createDbClient({
      databaseUrl:
        process.env.DATABASE_URL_TEST ??
        'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test',
      max: 2,
    });
    try {
      const other = createApplicationServices(secondClient);
      const makeConsumption = (service: typeof services, reference: string) =>
        service.transactions.create({
          tenantId,
          ledgerId: accounts.ledgerId,
          reference,
          currency: 'USD',
          entries: [
            {
              accountId: accounts.accountId,
              direction: EntryDirection.DEBIT,
              amountMinor: 75n,
              currency: 'USD',
            },
            {
              accountId: accounts.fundingAccountId,
              direction: EntryDirection.CREDIT,
              amountMinor: 75n,
              currency: 'USD',
            },
          ],
        });
      const results = await Promise.allSettled([
        makeConsumption(services, 'concurrent-consume-a'),
        makeConsumption(other, 'concurrent-consume-b'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(
        (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
      ).toBe(25n);
    } finally {
      await secondClient.sql.end({ timeout: 5 });
    }
  });

  it('reverses consumption with exact immutable compensation lineage', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    const consumed = await consume(tenantId, accounts, 'consume-60', 60n);
    const reversed = await services.transactions.reverse({
      tenantId,
      transactionId: consumed.transactionId,
      reference: 'reverse-consume-60',
    });
    expect(
      await services.creditGrants.listLineageByTransaction(tenantId, reversed.transactionId),
    ).toEqual([
      expect.objectContaining({ grantId: grant.grant.id, kind: 'COMPENSATION', amountMinor: 60n }),
    ]);
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.remainingMinor).toBe(100n);
    expect(balance.lots[0]?.consumedMinor).toBe(60n);
    expect(balance.lots[0]?.compensatedMinor).toBe(60n);
  });

  it('corrects consumption by compensating the original and allocating the replacement', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    const consumed = await consume(tenantId, accounts, 'consume-60', 60n);
    const corrected = await services.transactions.correct({
      tenantId,
      transactionId: consumed.transactionId,
      reversalReference: 'correct-consume-60-reversal',
      correctedReference: 'correct-consume-40',
      entries: [
        {
          accountId: accounts.accountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 40n,
          currency: 'USD',
        },
        {
          accountId: accounts.fundingAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 40n,
          currency: 'USD',
        },
      ],
    });
    expect(
      await services.creditGrants.listLineageByTransaction(
        tenantId,
        corrected.reversalTransactionId,
      ),
    ).toEqual([expect.objectContaining({ kind: 'COMPENSATION', amountMinor: 60n })]);
    expect(
      await services.creditGrants.listLineageByTransaction(
        tenantId,
        corrected.correctedTransactionId,
      ),
    ).toEqual([expect.objectContaining({ kind: 'CONSUMPTION', amountMinor: 40n })]);
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.remainingMinor).toBe(60n);
  });

  it('reverses overlapping multi-entry allocations exactly and rejects duplicate compensation', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-2'));
    const consumed = await consumeInTwoEntries(tenantId, accounts, 'consume-split');
    const originalLineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      consumed.transactionId,
    );
    const reversed = await services.transactions.reverse({
      tenantId,
      transactionId: consumed.transactionId,
      reference: 'reverse-consume-split',
    });
    const compensationLineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      reversed.transactionId,
    );
    expect(lineageTotalsByGrant(compensationLineage)).toEqual(
      lineageTotalsByGrant(originalLineage),
    );
    const auditOrder = compensationLineage.map(
      (allocation) =>
        `${allocation.createdAt.toISOString()}:${allocation.entryId}:${allocation.grantId}`,
    );
    expect(auditOrder).toEqual([...auditOrder].sort());

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const [entry] = await tx
          .insert(entries)
          .values({
            tenantId,
            transactionId: reversed.transactionId,
            accountId: accounts.accountId,
            direction: 'CREDIT',
            amountMinor: 1n,
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: entries.id });
        await tx.insert(creditGrantEntries).values({
          tenantId,
          ledgerId: accounts.ledgerId,
          accountId: accounts.accountId,
          grantId: originalLineage[0].grantId,
          entryId: entry.id,
          kind: 'COMPENSATION',
          amountMinor: 1n,
        });
      }),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(200n);
  });

  it('rejects a direct-SQL partial compensation transaction', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const first = await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-2'));
    const consumed = await consumeInTwoEntries(tenantId, accounts, 'consume-split-partial');

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const [reversal] = await tx
          .insert(transactions)
          .values({
            tenantId,
            ledgerId: accounts.ledgerId,
            relatedTransactionId: consumed.transactionId,
            relationType: 'REVERSAL',
            reference: 'direct-partial-compensation',
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: transactions.id });
        const inserted = await tx
          .insert(entries)
          .values([
            {
              tenantId,
              transactionId: reversal.id,
              accountId: accounts.accountId,
              direction: 'CREDIT',
              amountMinor: 100n,
              currency: 'USD',
              assetId: accounts.assetId,
            },
            {
              tenantId,
              transactionId: reversal.id,
              accountId: accounts.fundingAccountId,
              direction: 'DEBIT',
              amountMinor: 100n,
              currency: 'USD',
              assetId: accounts.assetId,
            },
          ])
          .returning({ id: entries.id, accountId: entries.accountId });
        const walletEntry = inserted.find((entry) => entry.accountId === accounts.accountId);
        if (!walletEntry) throw new Error('Missing wallet reversal entry');
        await tx.insert(creditGrantEntries).values({
          tenantId,
          ledgerId: accounts.ledgerId,
          accountId: accounts.accountId,
          grantId: first.grant.id,
          entryId: walletEntry.id,
          kind: 'COMPENSATION',
          amountMinor: 100n,
        });
      }),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(40n);
  });

  it('corrects overlapping multi-entry allocations through an exact reversal', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-2'));
    const consumed = await consumeInTwoEntries(tenantId, accounts, 'correct-split-original');
    const originalLineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      consumed.transactionId,
    );
    const corrected = await services.transactions.correct({
      tenantId,
      transactionId: consumed.transactionId,
      reversalReference: 'correct-split-reversal',
      correctedReference: 'correct-split-replacement',
      entries: [
        {
          accountId: accounts.accountId,
          direction: EntryDirection.DEBIT,
          amountMinor: 50n,
          currency: 'USD',
        },
        {
          accountId: accounts.fundingAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: 50n,
          currency: 'USD',
        },
      ],
    });
    const compensationLineage = await services.creditGrants.listLineageByTransaction(
      tenantId,
      corrected.reversalTransactionId,
    );
    expect(lineageTotalsByGrant(compensationLineage)).toEqual(
      lineageTotalsByGrant(originalLineage),
    );
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(150n);
    expect(
      await services.creditGrants.listLineageByTransaction(
        tenantId,
        corrected.correctedTransactionId,
      ),
    ).toEqual([
      expect.objectContaining({
        grantId: originalLineage[0].grantId,
        kind: 'CONSUMPTION',
        amountMinor: 50n,
      }),
    ]);
  });

  it('leaves ordinary multi-entry account posting behavior unchanged', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const debitAccount = await services.accounts.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      name: 'Ordinary debit',
      side: AccountSide.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
      assetId: accounts.assetId,
    });
    const creditAccount = await services.accounts.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      name: 'Ordinary credit',
      side: AccountSide.CREDIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
      assetId: accounts.assetId,
    });

    const posted = await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'ordinary-multi-entry',
      currency: 'USD',
      entries: [
        {
          accountId: debitAccount.id,
          direction: EntryDirection.DEBIT,
          amountMinor: 30n,
          currency: 'USD',
        },
        {
          accountId: debitAccount.id,
          direction: EntryDirection.DEBIT,
          amountMinor: 20n,
          currency: 'USD',
        },
        {
          accountId: creditAccount.id,
          direction: EntryDirection.CREDIT,
          amountMinor: 50n,
          currency: 'USD',
        },
      ],
    });

    expect(
      await services.creditGrants.listLineageByTransaction(tenantId, posted.transactionId),
    ).toEqual([]);
    const balances = await db
      .select({ id: accountRows.id, balanceMinor: accountRows.balanceMinor })
      .from(accountRows);
    expect(balances.find((row) => row.id === debitAccount.id)?.balanceMinor).toBe(-50n);
    expect(balances.find((row) => row.id === creditAccount.id)?.balanceMinor).toBe(50n);
  });

  it('supports multiple grant-enabled accounts with different assets', async () => {
    const tenantId = await createTenant(db, 'A');
    const usd = await setup(tenantId);
    const bonusAsset = await services.assets.create({ tenantId, code: 'BONUS', scale: 0 });
    const bonusAccount = await services.accounts.create({
      tenantId,
      ledgerId: usd.ledgerId,
      name: 'Bonus lots',
      side: AccountSide.CREDIT,
      overdraftPolicy: 'DISALLOW',
      currency: 'BONUS',
      assetId: bonusAsset.id,
    });
    const bonusFunding = await services.accounts.create({
      tenantId,
      ledgerId: usd.ledgerId,
      name: 'Bonus funding',
      side: AccountSide.DEBIT,
      currency: 'BONUS',
      assetId: bonusAsset.id,
    });

    await services.creditGrants.create(grantInput(tenantId, usd, 'usd-lot'));
    await services.creditGrants.create({
      ...grantInput(
        tenantId,
        {
          ledgerId: usd.ledgerId,
          assetId: bonusAsset.id,
          accountId: bonusAccount.id,
          fundingAccountId: bonusFunding.id,
        },
        'bonus-lot',
      ),
    });

    expect((await services.creditGrants.getBalance(tenantId, usd.accountId)).assetId).toBe(
      usd.assetId,
    );
    const bonusBalance = await services.creditGrants.getBalance(tenantId, bonusAccount.id);
    expect(bonusBalance.assetId).toBe(bonusAsset.id);
    expect(bonusBalance.lots[0]?.remainingMinor).toBe(100n);
  });

  it('accepts identical retry, rejects conflicts and foreign tenant or asset access', async () => {
    const tenantId = await createTenant(db, 'A');
    const otherTenantId = await createTenant(db, 'B');
    const accounts = await setup(tenantId);
    const other = await setup(otherTenantId);
    const input = grantInput(tenantId, accounts, 'buy-1');
    const first = await services.creditGrants.create(input);
    const retry = await services.creditGrants.create(input);
    expect(retry.created).toBeFalse();
    expect(retry.grant.id).toBe(first.grant.id);
    await expect(
      services.creditGrants.create({ ...input, amountMinor: 101n }),
    ).rejects.toBeInstanceOf(CreditGrantConflictError);
    await expect(
      services.creditGrants.create({ ...input, externalReference: 'different-order' }),
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
        ledgerId: anotherLedger.ledgerId,
        accountId: anotherLedger.accountId,
        fundingAccountId: anotherLedger.fundingAccountId,
      }),
    ).rejects.toThrow('Grant reference already belongs to another ledger or account');
    await expect(
      services.creditGrants.create({
        ...input,
        reference: 'another-ledger-funding',
        fundingAccountId: anotherLedger.fundingAccountId,
      }),
    ).rejects.toThrow();
  });

  it('serializes concurrent adoption and duplicate grants and records one compensation', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const input = grantInput(tenantId, accounts, 'concurrent');
    const secondClient = createDbClient({
      databaseUrl:
        process.env.DATABASE_URL_TEST ??
        'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test',
      max: 2,
    });
    try {
      const other = createApplicationServices(secondClient);
      const firstAdoption = await Promise.all([
        services.creditGrants.create({ ...input, reference: 'first-adoption-a' }),
        other.creditGrants.create({ ...input, reference: 'first-adoption-b' }),
      ]);
      expect(firstAdoption.every((item) => item.created)).toBeTrue();
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
      expect(balance.ledgerBalanceMinor).toBe(400n + accepted.value.grant.amountMinor);
      expect(balance.lots.find((lot) => lot.grantId === a.grant.id)?.reversedMinor).toBe(100n);
    } finally {
      await secondClient.sql.end({ timeout: 5 });
    }
  });

  it('rejects an untracked ledger posting and preserves the reconciled balance', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    await services.creditGrants.create(grantInput(tenantId, accounts, 'grant-1'));
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

  it('validates issuance amount and preserves immutable grant history', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const purchased = grantInput(tenantId, accounts, 'buy-1');
    await expect(
      services.creditGrants.create({ ...purchased, amountMinor: -1n }),
    ).rejects.toBeInstanceOf(InvalidCreditGrantError);
    const result = await services.creditGrants.create(purchased);
    await expect(
      (async () => {
        await db
          .update(creditGrants)
          .set({ externalReference: 'tampered' })
          .where(eq(creditGrants.id, result.grant.id));
      })(),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });

  it('allows only one of two concurrent reversal references', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
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

  it('scopes a reversal idempotency reference to one grant within the tenant', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const first = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
    const second = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-2'));

    const reversed = await services.creditGrants.reverse({
      tenantId,
      grantId: first.grant.id,
      reference: 'shared-refund',
    });
    expect(reversed.created).toBeTrue();
    expect(
      (
        await services.creditGrants.reverse({
          tenantId,
          grantId: first.grant.id,
          reference: 'shared-refund',
        })
      ).created,
    ).toBeFalse();
    await expect(
      services.creditGrants.reverse({
        tenantId,
        grantId: second.grant.id,
        reference: 'shared-refund',
      }),
    ).rejects.toThrow('Reversal reference belongs to another grant');
    expect(
      (await services.creditGrants.getById(tenantId, second.grant.id)).reversedByTransactionId,
    ).toBeNull();
  });

  it('rejects partial and duplicate reversal links at the PostgreSQL boundary', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const [reversal] = await tx
          .insert(transactions)
          .values({
            tenantId,
            ledgerId: accounts.ledgerId,
            relatedTransactionId: grant.grant.transactionId,
            relationType: 'REVERSAL',
            reference: 'direct-partial-reversal',
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: transactions.id });
        const [entry] = await tx
          .insert(entries)
          .values({
            tenantId,
            transactionId: reversal.id,
            accountId: accounts.accountId,
            direction: 'DEBIT',
            amountMinor: 50n,
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: entries.id });
        await tx.insert(creditGrantEntries).values({
          tenantId,
          ledgerId: accounts.ledgerId,
          accountId: accounts.accountId,
          grantId: grant.grant.id,
          entryId: entry.id,
          kind: 'REVERSAL',
          amountMinor: 50n,
        });
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(creditGrantEntries)
        .where(eq(creditGrantEntries.grantId, grant.grant.id)),
    ).toHaveLength(1);

    const reversed = await services.creditGrants.reverse({
      tenantId,
      grantId: grant.grant.id,
      reference: 'full-reversal',
    });
    const reversalTransactionId = reversed.grant.reversedByTransactionId;
    if (!reversalTransactionId) throw new Error('Expected reversal transaction');
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const [entry] = await tx
          .insert(entries)
          .values({
            tenantId,
            transactionId: reversalTransactionId,
            accountId: accounts.accountId,
            direction: 'DEBIT',
            amountMinor: 100n,
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: entries.id });
        await tx.insert(creditGrantEntries).values({
          tenantId,
          ledgerId: accounts.ledgerId,
          accountId: accounts.accountId,
          grantId: grant.grant.id,
          entryId: entry.id,
          kind: 'REVERSAL',
          amountMinor: 100n,
        });
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(creditGrantEntries)
        .where(eq(creditGrantEntries.grantId, grant.grant.id)),
    ).toHaveLength(2);
  });

  it('uses ledger entries as source of truth when the account balance cache drifts', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
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
    const balance = await services.creditGrants.getBalance(tenantId, accounts.accountId);
    expect(balance.ledgerBalanceMinor).toBe(100n);
    expect(balance.remainingMinor).toBe(100n);
    expect(balance.lots[0]?.remainingMinor).toBe(100n);
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
    const [updatedPosting] = await db
      .update(transactions)
      .set({ description: 'unrelated update remains effective' })
      .where(eq(transactions.id, posting.transactionId))
      .returning({ description: transactions.description });
    expect(updatedPosting?.description).toBe('unrelated update remains effective');
    const row = {
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.accountId,
      fundingAccountId: accounts.fundingAccountId,
      reference: 'direct-invalid',
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
        ...grantInput(tenantId, accounts, 'wrong-funding-asset'),
        fundingAccountId: funding.id,
      }),
    ).rejects.toThrow('Funding account asset mismatch');
  });

  it('rejects an explicitly incompatible funding account currency', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const [funding] = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return tx
        .insert(accountRows)
        .values({
          tenantId,
          ledgerId: accounts.ledgerId,
          name: 'Legacy currency mismatch',
          side: 'DEBIT',
          currency: 'LEGACY_USD',
          assetId: accounts.assetId,
        })
        .returning({ id: accountRows.id });
    });
    await expect(
      services.creditGrants.create({
        ...grantInput(tenantId, accounts, 'wrong-funding-currency'),
        fundingAccountId: funding.id,
      }),
    ).rejects.toThrow('Funding account currency mismatch');
  });

  it('does not treat the funding account natural side as a posting restriction', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const funding = await services.accounts.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      name: 'Credit-side funding',
      side: AccountSide.CREDIT,
      currency: 'USD',
      assetId: accounts.assetId,
    });

    const result = await services.creditGrants.create({
      ...grantInput(tenantId, accounts, 'credit-side-funding'),
      fundingAccountId: funding.id,
    });
    expect(result.created).toBeTrue();
    expect(result.grant.fundingAccountId).toBe(funding.id);
  });

  it('enforces entry attribution at the PostgreSQL boundary without changing account kind', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
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
          .set({ amountMinor: link.amountMinor })
          .where(eq(creditGrantEntries.entryId, link.entryId));
      })(),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });

  it('rejects direct-SQL consumption beyond immutable grant capacity', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const [transaction] = await tx
          .insert(transactions)
          .values({
            tenantId,
            ledgerId: accounts.ledgerId,
            reference: 'direct-over-allocation',
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: transactions.id });
        const [entry] = await tx
          .insert(entries)
          .values({
            tenantId,
            transactionId: transaction.id,
            accountId: accounts.accountId,
            direction: 'DEBIT',
            amountMinor: 101n,
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: entries.id });
        await tx.insert(creditGrantEntries).values({
          tenantId,
          ledgerId: accounts.ledgerId,
          accountId: accounts.accountId,
          grantId: grant.grant.id,
          entryId: entry.id,
          kind: 'CONSUMPTION',
          amountMinor: 101n,
        });
      }),
    ).rejects.toThrow();
    expect(
      (await services.creditGrants.getBalance(tenantId, accounts.accountId)).remainingMinor,
    ).toBe(100n);
  });

  it('rejects grant attribution when the transaction asset differs from the account asset', async () => {
    const tenantId = await createTenant(db, 'A');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create(grantInput(tenantId, accounts, 'buy-1'));
    const otherAsset = await services.assets.create({ tenantId, code: 'BONUS', scale: 0 });

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const [transaction] = await tx
          .insert(transactions)
          .values({
            tenantId,
            ledgerId: accounts.ledgerId,
            relatedTransactionId: grant.grant.transactionId,
            relationType: 'REVERSAL',
            reference: 'wrong-transaction-asset',
            currency: 'BONUS',
            assetId: otherAsset.id,
          })
          .returning({ id: transactions.id });
        const [entry] = await tx
          .insert(entries)
          .values({
            tenantId,
            transactionId: transaction.id,
            accountId: accounts.accountId,
            direction: 'DEBIT',
            amountMinor: 100n,
            currency: 'USD',
            assetId: accounts.assetId,
          })
          .returning({ id: entries.id });
        await tx.insert(creditGrantEntries).values({
          tenantId,
          ledgerId: accounts.ledgerId,
          accountId: accounts.accountId,
          grantId: grant.grant.id,
          entryId: entry.id,
          kind: 'REVERSAL',
          amountMinor: 100n,
        });
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(creditGrantEntries)
        .where(eq(creditGrantEntries.grantId, grant.grant.id)),
    ).toHaveLength(1);
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
      services.creditGrants.create(grantInput(tenantId, accounts, 'late-adoption')),
    ).rejects.toBeInstanceOf(CreditGrantConflictError);
  });
});
