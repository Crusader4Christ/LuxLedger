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

it('upgrades legacy unsigned entries to signed amounts and reserved deltas (LL-104 migration 0002)', async () => {
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  const tags: string[] = journal.entries
    .filter((entry: { idx: number }) => entry.idx <= 2)
    .map((entry: { tag: string }) => entry.tag);
  try {
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`DROP SCHEMA public CASCADE`);
        await tx.execute(sql`CREATE SCHEMA public`);
        for (const tag of tags.slice(0, 2)) await applyFile(tx, tag);

        const [tenant] = await tx.execute(
          sql`insert into tenants (name) values ('Legacy') returning id`,
        );
        const tenantId = tenant?.id as string;
        const [ledger] = await tx.execute(
          sql`insert into ledgers (tenant_id, name) values (${tenantId}, 'L') returning id`,
        );
        const ledgerId = ledger?.id as string;
        const [asset] = await tx.execute(
          sql`insert into assets (tenant_id, code, scale) values (${tenantId}, 'USD', 2) returning id`,
        );
        const assetId = asset?.id as string;
        const insertAccount = async (
          name: string,
          side: string,
          balance: number,
          inflightDebit: number,
          inflightCredit: number,
        ) => {
          const [row] = await tx.execute(sql`insert into accounts
          (tenant_id, ledger_id, name, side, currency, asset_id, balance_minor,
           inflight_debit_minor, inflight_credit_minor)
          values (${tenantId}, ${ledgerId}, ${name}, ${side}::account_side, 'USD', ${assetId},
                  ${balance}, ${inflightDebit}, ${inflightCredit}) returning id`);
          return row?.id as string;
        };
        const debitAccount = await insertAccount('Cash', 'DEBIT', 100, 0, 30);
        const creditAccount = await insertAccount('Revenue', 'CREDIT', 100, 20, 0);

        const [transaction] = await tx.execute(sql`insert into transactions
        (tenant_id, ledger_id, reference, currency, asset_id)
        values (${tenantId}, ${ledgerId}, 'legacy', 'USD', ${assetId}) returning id`);
        const transactionId = transaction?.id as string;
        for (const [accountId, direction] of [
          [debitAccount, 'DEBIT'],
          [creditAccount, 'CREDIT'],
        ] as const) {
          await tx.execute(sql`insert into entries
          (tenant_id, transaction_id, account_id, direction, amount_minor, currency, asset_id)
          values (${tenantId}, ${transactionId}, ${accountId}, ${direction}::entry_direction,
                  100, 'USD', ${assetId})`);
        }
        await tx.execute(sql`insert into balance_snapshots
        (tenant_id, ledger_id, account_id, event_type, source_id, posted_minor,
         inflight_debit_minor, inflight_credit_minor)
        select tenant_id, ledger_id, id, 'TX_APPLIED', ${transactionId}, balance_minor,
               inflight_debit_minor, inflight_credit_minor
        from accounts where tenant_id = ${tenantId}`);

        // Fire deferred constraint triggers so ALTER TABLE is allowed in the same transaction.
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        await applyFile(tx, tags[2] as string);

        const entryRows = await tx.execute(sql`select account_id, signed_amount_minor
        from entries where transaction_id = ${transactionId}`);
        const signedByAccount = new Map(
          entryRows.map((row) => [row.account_id as string, String(row.signed_amount_minor)]),
        );
        expect(signedByAccount.get(debitAccount)).toBe('100');
        expect(signedByAccount.get(creditAccount)).toBe('-100');

        const accountRows = await tx.execute(sql`select id, balance_minor, reserved_delta_minor
        from accounts where tenant_id = ${tenantId}`);
        const accountById = new Map(
          accountRows.map((row) => [
            row.id as string,
            [String(row.balance_minor), String(row.reserved_delta_minor)],
          ]),
        );
        expect(accountById.get(debitAccount)).toEqual(['-100', '-30']);
        expect(accountById.get(creditAccount)).toEqual(['-100', '20']);

        const snapshotRows =
          await tx.execute(sql`select account_id, posted_minor, reserved_delta_minor
        from balance_snapshots where tenant_id = ${tenantId}`);
        const snapshotById = new Map(
          snapshotRows.map((row) => [
            row.account_id as string,
            [String(row.posted_minor), String(row.reserved_delta_minor)],
          ]),
        );
        expect(snapshotById.get(debitAccount)).toEqual(['-100', '-30']);
        expect(snapshotById.get(creditAccount)).toEqual(['-100', '20']);

        await expect(
          tx
            .execute(
              sql`update entries set signed_amount_minor = 0 where transaction_id = ${transactionId}`,
            )
            .execute(),
        ).rejects.toThrow();
        throw new Error('rollback upgrade fixture');
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== 'rollback upgrade fixture') throw error;
      });
  } finally {
    await migrateTestDatabase(db);
  }
});
