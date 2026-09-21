import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AccountSide, EntryDirection } from '@luxledger/core';
import { InvariantViolationError } from '@luxledger/core/application';
import { eq } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import { accounts, assets, entries, transactions } from '../../src/schema';
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

describe('tenant assets', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('creates CREDIT and EUR with stable tenant identity and immutable scale', async () => {
    const tenantId = await createTenant(db, 'A');
    const otherTenantId = await createTenant(db, 'B');
    const credit = await services.assets.create({ tenantId, code: 'CREDIT', scale: 0 });
    const euro = await services.assets.create({ tenantId, code: 'EUR', scale: 2 });
    const otherCredit = await services.assets.create({
      tenantId: otherTenantId,
      code: 'CREDIT',
      scale: 0,
    });
    expect(credit.id).not.toBe(otherCredit.id);
    expect(await services.assets.list(tenantId)).toHaveLength(3);
    expect((await services.assets.getById(tenantId, euro.id)).scale).toBe(2);
    await expect(services.assets.getById(otherTenantId, euro.id)).rejects.toThrow();
    await expect(
      services.assets.create({ tenantId, code: 'CREDIT', scale: 0 }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      services.assets.create({ tenantId, code: 'eur', scale: 2 }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      (async () => {
        await db.update(assets).set({ scale: 3 }).where(eq(assets.id, euro.id));
      })(),
    ).rejects.toThrow();
  });

  it('posts and retries one asset, rejects mixed and cross-tenant identities', async () => {
    const tenantId = await createTenant(db, 'A');
    const otherTenantId = await createTenant(db, 'B');
    const ledgerId = await createLedger(db, tenantId, 'Main');
    const credit = await services.assets.create({ tenantId, code: 'CREDIT', scale: 0 });
    const euro = await services.assets.create({ tenantId, code: 'EUR', scale: 2 });
    const otherCredit = await services.assets.create({
      tenantId: otherTenantId,
      code: 'CREDIT',
      scale: 0,
    });
    const debit = await services.accounts.create({
      tenantId,
      ledgerId,
      name: 'Debit',
      side: AccountSide.DEBIT,
      currency: 'CREDIT',
      assetId: credit.id,
    });
    const contra = await services.accounts.create({
      tenantId,
      ledgerId,
      name: 'Contra',
      side: AccountSide.CREDIT,
      currency: 'CREDIT',
    });
    const eurAccount = await services.accounts.create({
      tenantId,
      ledgerId,
      name: 'Euro',
      side: AccountSide.DEBIT,
      currency: 'EUR',
      assetId: euro.id,
    });
    expect(debit.assetId).toBe(credit.id);
    expect(contra.assetId).toBe(credit.id);
    await expect(
      services.accounts.create({
        tenantId,
        ledgerId,
        name: 'Bad',
        side: AccountSide.DEBIT,
        currency: 'CREDIT',
        assetId: otherCredit.id,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      (async () => {
        await db
          .update(accounts)
          .set({ assetId: euro.id, currency: 'EUR' })
          .where(eq(accounts.id, debit.id));
      })(),
    ).rejects.toThrow();

    const input = {
      tenantId,
      ledgerId,
      reference: 'credit-post',
      currency: 'CREDIT',
      entries: [
        {
          accountId: debit.id,
          direction: EntryDirection.DEBIT,
          amountMinor: 5n,
          currency: 'CREDIT',
        },
        {
          accountId: contra.id,
          direction: EntryDirection.CREDIT,
          amountMinor: 5n,
          currency: 'CREDIT',
        },
      ],
    };
    const first = await services.transactions.create(input);
    expect(first.created).toBeTrue();
    const retry = await services.transactions.create(input);
    expect(retry).toEqual({ transactionId: first.transactionId, created: false });
    await expect(
      services.transactions.create({
        ...input,
        entries: input.entries.map((entry) => ({ ...entry, amountMinor: 6n })),
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      services.transactions.create({
        ...input,
        reference: 'mixed',
        entries: [input.entries[0], { ...input.entries[1], accountId: eurAccount.id }],
      }),
    ).rejects.toThrow();
    const [posted] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, first.transactionId));
    const postedEntries = await db
      .select()
      .from(entries)
      .where(eq(entries.transactionId, first.transactionId));
    expect(posted.assetId).toBe(credit.id);
    expect(postedEntries.every((entry) => entry.assetId === credit.id)).toBeTrue();
    expect((await services.transactions.getById(tenantId, first.transactionId)).assetId).toBe(
      credit.id,
    );
    await expect(
      (async () => {
        await db.update(accounts).set({ assetId: euro.id }).where(eq(accounts.id, debit.id));
      })(),
    ).rejects.toThrow();
  });
});
