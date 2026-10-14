import { afterAll, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import { creditGrantHoldAllocations, holdEntries, holds } from '../../src/schema';
import {
  createLedger,
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  createTenant,
  migrateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
afterAll(() => client.sql.end({ timeout: 5 }));

it('upgrades active partially consumed reservations and preserves migration atomicity', async () => {
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  const migration = await Bun.file(
    'drizzle/0005_2026-10-14-grant-reservation-snapshots.sql',
  ).text();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP SCHEMA public CASCADE`);
      await tx.execute(sql`CREATE SCHEMA public`);
      for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 5)) {
        const content = await Bun.file(`drizzle/${entry.tag}.sql`).text();
        for (const statement of content.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.execute(sql.raw(statement));
        }
      }
    });
    const tenantId = await createTenant(db, 'upgrade');
    const ledgerId = await createLedger(db, tenantId, 'Credits');
    const services = createApplicationServices(client);
    const asset = (await services.assets.list(tenantId)).find((asset) => asset.code === 'USD');
    if (!asset) throw new Error('Missing asset');
    const wallet = await services.accounts.create({
      tenantId,
      ledgerId,
      name: 'Wallet',
      side: 'CREDIT',
      overdraftPolicy: 'DISALLOW',
      grantEnabled: true,
      currency: 'USD',
      assetId: asset.id,
    });
    const funding = await services.accounts.create({
      tenantId,
      ledgerId,
      name: 'Funding',
      side: 'DEBIT',
      currency: 'USD',
      assetId: asset.id,
    });
    const { grant } = await services.creditGrants.create({
      tenantId,
      ledgerId,
      accountId: wallet.id,
      fundingAccountId: funding.id,
      reference: 'grant',
      amountMinor: 100n,
    });
    // Seed through the old schema's actual SQL guards, without the new adapter's
    // reservation snapshot reads (those columns do not exist until migration 0005).
    const holdId = await client.runTenantTx(tenantId, 'seed old reservation', async (tx) => {
      const [hold] = await tx
        .insert(holds)
        .values({
          tenantId,
          ledgerId,
          reference: 'hold',
          currency: 'USD',
          assetId: asset.id,
          originalAmountMinor: 80n,
          remainingAmountMinor: 80n,
        })
        .returning();
      const [debit] = await tx
        .insert(holdEntries)
        .values([
          {
            tenantId,
            holdId: hold.id,
            accountId: wallet.id,
            currency: 'USD',
            assetId: asset.id,
            signedAmountMinor: 80n,
          },
          {
            tenantId,
            holdId: hold.id,
            accountId: funding.id,
            currency: 'USD',
            assetId: asset.id,
            signedAmountMinor: -80n,
          },
        ])
        .returning();
      await tx.insert(creditGrantHoldAllocations).values({
        tenantId,
        ledgerId,
        accountId: wallet.id,
        grantId: grant.id,
        holdEntryId: debit.id,
        amountMinor: 80n,
      });
      await tx.execute(sql`update accounts set reserved_delta_minor = case when id = ${wallet.id} then 80 else -80 end
        where tenant_id = ${tenantId} and id in (${wallet.id}, ${funding.id})`);
      return hold.id;
    });
    await services.holds.commit({
      tenantId,
      holdId,
      reference: 'before-upgrade',
      amountMinor: 30n,
    });
    const applyMigration = async (abort: boolean) =>
      db.transaction(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.execute(sql.raw(statement));
        }
        if (abort) throw new Error('abort upgrade');
      });
    await expect(applyMigration(true)).rejects.toThrow('abort upgrade');
    const columns = await db.execute(sql`select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credit_grant_capacity_versions' and column_name = 'reserved_minor'`);
    expect(columns).toHaveLength(0);
    await applyMigration(false);
    const [checkpoint] = await db.execute<{ reserved: string; remaining: string }>(sql`
      select reserved_minor::text as reserved, remaining_minor::text as remaining
      from credit_grant_capacity_versions order by version desc limit 1
    `);
    expect(checkpoint).toMatchObject({ reserved: '50', remaining: '70' });
    await services.holds.commit({ tenantId, holdId, reference: 'after-upgrade', amountMinor: 20n });
    await services.holds.void({ tenantId, holdId });
    const [final] = await db.execute<{ reserved: string; remaining: string }>(sql`
      select reserved_minor::text as reserved, remaining_minor::text as remaining
      from credit_grant_capacity_versions order by version desc limit 1
    `);
    expect(final).toMatchObject({ reserved: '0', remaining: '50' });
  } finally {
    await migrateTestDatabase(db);
  }
});
