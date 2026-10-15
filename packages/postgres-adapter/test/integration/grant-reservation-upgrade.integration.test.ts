import { afterAll, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
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

it('upgrades existing grants from pre-LL-101 schema and preserves migration atomicity', async () => {
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  const migration = await Bun.file('drizzle/0004_grant_hold_allocations.sql').text();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP SCHEMA public CASCADE`);
      await tx.execute(sql`CREATE SCHEMA public`);
      for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 4)) {
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
    const [rolledBack] = await db.execute(
      sql`select to_regclass('public.credit_grant_hold_allocations') as allocations`,
    );
    expect(rolledBack.allocations).toBeNull();
    const [original] = await db.execute(
      sql`select remaining_minor::text as remaining from credit_grant_capacity_versions where grant_id = ${grant.id} order by version desc limit 1`,
    );
    expect(original.remaining).toBe('100');
    await applyMigration(false);
    const [checkpoint] = await db.execute<{ reserved: string; remaining: string }>(sql`
      select reserved_minor::text as reserved, remaining_minor::text as remaining
      from credit_grant_capacity_versions order by version desc limit 1
    `);
    expect(checkpoint).toMatchObject({ reserved: '0', remaining: '100' });
    const { holdId } = await services.holds.create({
      tenantId,
      ledgerId,
      reference: 'after-upgrade-hold',
      currency: 'USD',
      entries: [
        { accountId: wallet.id, signedAmountMinor: 80n, currency: 'USD' },
        { accountId: funding.id, signedAmountMinor: -80n, currency: 'USD' },
      ],
    });
    await services.holds.commit({ tenantId, holdId, reference: 'after-upgrade', amountMinor: 20n });
    await services.holds.void({ tenantId, holdId });
    const [final] = await db.execute<{ reserved: string; remaining: string }>(sql`
      select reserved_minor::text as reserved, remaining_minor::text as remaining
      from credit_grant_capacity_versions order by version desc limit 1
    `);
    expect(final).toMatchObject({ reserved: '0', remaining: '80' });
  } finally {
    await migrateTestDatabase(db);
  }
});
