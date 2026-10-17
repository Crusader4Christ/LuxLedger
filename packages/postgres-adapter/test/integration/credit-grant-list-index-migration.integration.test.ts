import { afterAll, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  migrateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
afterAll(() => client.sql.end({ timeout: 5 }));

const applyFile = async (tx: Pick<typeof db, 'execute'>, tag: string) => {
  const content = await Bun.file(`drizzle/${tag}.sql`).text();
  for (const statement of content.split('--> statement-breakpoint')) {
    if (statement.trim()) await tx.execute(sql.raw(statement));
  }
};

it('adds the tenant grant-list index without changing 0.3.0 data', async () => {
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  const baselineTags: string[] = journal.entries
    .filter((entry: { idx: number }) => entry.idx < 5)
    .map((entry: { tag: string }) => entry.tag);
  const migrationTag = journal.entries.find((entry: { idx: number }) => entry.idx === 5)?.tag;
  if (!migrationTag) throw new Error('Missing migration 0005');

  try {
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`DROP SCHEMA public CASCADE`);
        await tx.execute(sql`CREATE SCHEMA public`);
        for (const tag of baselineTags) await applyFile(tx, tag);

        const [tenant] = await tx.execute(
          sql`insert into tenants (name) values ('Index upgrade') returning id`,
        );
        const tenantId = tenant?.id as string;
        const [ledger] = await tx.execute(
          sql`insert into ledgers (tenant_id, name) values (${tenantId}, 'Credits') returning id`,
        );
        const ledgerId = ledger?.id as string;
        const [asset] = await tx.execute(
          sql`insert into assets (tenant_id, code, scale) values (${tenantId}, 'USD', 2) returning id`,
        );
        const assetId = asset?.id as string;
        const [grantAccount] = await tx.execute(sql`insert into accounts
          (tenant_id, ledger_id, name, side, overdraft_policy, grant_enabled, currency, asset_id)
          values (${tenantId}, ${ledgerId}, 'Wallet', 'CREDIT', 'DISALLOW', true, 'USD', ${assetId})
          returning id`);
        const [fundingAccount] = await tx.execute(sql`insert into accounts
          (tenant_id, ledger_id, name, side, currency, asset_id)
          values (${tenantId}, ${ledgerId}, 'Funding', 'DEBIT', 'USD', ${assetId}) returning id`);
        const [transaction] = await tx.execute(sql`insert into transactions
          (tenant_id, ledger_id, reference, currency, asset_id)
          values (${tenantId}, ${ledgerId}, 'grant-index-upgrade', 'USD', ${assetId}) returning id`);
        await tx.execute(sql`insert into credit_grants
          (tenant_id, ledger_id, account_id, funding_account_id, reference, transaction_id)
          values (${tenantId}, ${ledgerId}, ${grantAccount?.id as string},
                  ${fundingAccount?.id as string}, 'preserved-grant', ${transaction?.id as string})`);

        await applyFile(tx, migrationTag);

        const grants = await tx.execute(
          sql`select reference from credit_grants where tenant_id = ${tenantId}`,
        );
        expect(grants.map((row) => row.reference)).toEqual(['preserved-grant']);
        const [index] = await tx.execute(sql`select indexdef from pg_indexes
          where schemaname = 'public' and indexname = 'credit_grants_tenant_created_id_idx'`);
        expect(index?.indexdef).toContain('(tenant_id, created_at, id)');

        throw new Error('rollback upgrade fixture');
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== 'rollback upgrade fixture') throw error;
      });
  } finally {
    await migrateTestDatabase(db);
  }
});
