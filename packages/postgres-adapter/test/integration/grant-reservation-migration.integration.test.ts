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

it('installs LL-101 atomically and rolls back its DDL on failure', async () => {
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  const migration = await Bun.file('drizzle/0004_grant_hold_allocations.sql').text();
  try {
    // Install dependencies on an empty disposable database, not a legacy data fixture.
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
    const applyMigration = async (abort: boolean) =>
      db.transaction(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.execute(sql.raw(statement));
        }
        if (abort) throw new Error('abort migration');
      });
    await expect(applyMigration(true)).rejects.toThrow('abort migration');
    const columns = await db.execute(sql`select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credit_grant_capacity_versions'
        and column_name in ('reserved_minor', 'source_allocation_id', 'source_hold_id')`);
    expect(columns).toHaveLength(0);
    const [rolledBack] = await db.execute(
      sql`select to_regclass('public.credit_grant_hold_allocations') as allocations`,
    );
    expect(rolledBack.allocations).toBeNull();
    await applyMigration(false);
    const installed = await db.execute(sql`select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credit_grant_capacity_versions'
        and column_name in ('reserved_minor', 'source_allocation_id', 'source_hold_id')`);
    expect(installed).toHaveLength(3);
  } finally {
    await migrateTestDatabase(db);
  }
});
