import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { type SQL, sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import { createDbClient, type DbClient, type DrizzleDatabase } from '../../src/client';
import {
  createLedger,
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  createTenant,
  databaseUrl,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const services = createApplicationServices(client);
beforeAll(() => migrateTestDatabase(db));
beforeEach(() => truncateTestDatabase(db));
afterAll(() => client.sql.end({ timeout: 5 }));

const fixture = async (name: string) => {
  const tenantId = await createTenant(db, name);
  const ledgerId = await createLedger(db, tenantId, name);
  const asset = (await services.assets.list(tenantId))[0];
  const wallet = await services.accounts.create({
    tenantId,
    ledgerId,
    assetId: asset.id,
    name: 'Wallet',
    currency: 'USD',
    side: 'CREDIT',
    overdraftPolicy: 'DISALLOW',
    grantEnabled: true,
  });
  const funding = await services.accounts.create({
    tenantId,
    ledgerId,
    assetId: asset.id,
    name: 'Funding',
    currency: 'USD',
    side: 'DEBIT',
  });
  const { grant } = await services.creditGrants.create({
    tenantId,
    ledgerId,
    accountId: wallet.id,
    fundingAccountId: funding.id,
    reference: 'grant',
    amountMinor: 100n,
  });
  const request = {
    tenantId,
    ledgerId,
    currency: 'USD',
    reference: 'hold',
    entries: [
      { accountId: wallet.id, currency: 'USD', signedAmountMinor: 80n },
      { accountId: funding.id, currency: 'USD', signedAmountMinor: -80n },
    ],
  };
  const hold = await services.holds.create(request);
  return { tenantId, ledgerId, asset, wallet, funding, grant, hold, request };
};

const scopedClient = (tx: DrizzleDatabase): DbClient => ({
  sql: client.sql,
  execute: (operation, action) => client.execute(operation, () => action(tx)),
  runTx: (operation, action) => client.execute(operation, () => action(tx)),
  runTenantTx: (_tenant, operation, action) =>
    client.execute(operation, () => tx.transaction(action)),
});

const publicFailure = async (action: () => Promise<unknown>) => {
  try {
    await action();
    throw new Error('Expected rejection');
  } catch (error) {
    const value = error as Error & { code?: string; httpStatus?: number };
    if (value.code === 'INTERNAL_ERROR') throw error;
    expect(value.code).toBeDefined();
    return { code: value.code, message: value.message, status: value.httpStatus };
  }
};

it('reports LL002 before a hold consumption can underflow a damaged reservation snapshot', async () => {
  const f = await fixture('reservation-underflow');
  const before = await db.execute(
    sql`select * from credit_grant_capacity_versions order by version`,
  );
  // Fault injection only: normal writers cannot corrupt the immutable snapshot.
  // Both the temporary trigger change and corruption roll back with the failed commit.
  await expect(
    client.runTenantTx(f.tenantId, 'check reserved underflow', async (tx) => {
      await tx.execute(
        sql`alter table credit_grant_capacity_versions disable trigger credit_grant_capacity_versions_immutable`,
      );
      await tx.execute(
        sql`update credit_grant_capacity_versions set reserved_minor = 0 where grant_id = ${f.grant.id}`,
      );
      await tx.execute(
        sql`alter table credit_grant_capacity_versions enable trigger credit_grant_capacity_versions_immutable`,
      );
      await createApplicationServices(scopedClient(tx)).holds.commit({
        tenantId: f.tenantId,
        holdId: f.hold.holdId,
        reference: 'underflow',
        amountMinor: 20n,
      });
    }),
  ).rejects.toMatchObject({
    code: 'INSUFFICIENT_RESERVED_CAPACITY',
    cause: { cause: { code: 'LL002' } },
  });
  expect(
    await db.execute(sql`select * from credit_grant_capacity_versions order by version`),
  ).toEqual(before);
  const [posting] = await db.execute(
    sql`select count(*)::int as count from transactions where hold_id = ${f.hold.holdId}`,
  );
  expect(posting.count).toBe(0);
});

it('rejects every illegal hold state edge and accepts only forward transitions', async () => {
  const f = await fixture('lifecycle-matrix');
  const mutations: SQL[] = [
    sql`state = 'HELD'`,
    sql`remaining_amount_minor = 81`,
    sql`remaining_amount_minor = 79`,
    sql`remaining_amount_minor = -1`,
    sql`original_amount_minor = 90`,
    sql`reference = 'replacement'`,
    sql`description = 'replacement'`,
    sql`currency = 'EUR'`,
    sql`applied_at = now()`,
    sql`voided_at = now()`,
    sql`state = 'APPLIED', remaining_amount_minor = 0, applied_at = now()`,
    sql`state = 'VOIDED', remaining_amount_minor = 0`,
  ];
  for (const mutation of mutations) {
    await expect(
      db.execute(sql`update holds set ${mutation} where id = ${f.hold.holdId}`).execute(),
    ).rejects.toMatchObject({ cause: { code: 'LL001' } });
  }
  await expect(
    db.execute(sql`delete from holds where id = ${f.hold.holdId}`).execute(),
  ).rejects.toMatchObject({ cause: { code: 'LL001' } });
  await expect(
    db
      .execute(sql`insert into holds (tenant_id,ledger_id,asset_id,currency,reference,state,original_amount_minor,remaining_amount_minor)
    values (${f.tenantId},${f.ledgerId},${f.asset.id},'USD','final-insert','VOIDED',80,0)`)
      .execute(),
  ).rejects.toMatchObject({ cause: { code: 'LL001' } });
  const command = {
    tenantId: f.tenantId,
    holdId: f.hold.holdId,
    reference: 'partial',
    amountMinor: 20n,
  };
  await services.holds.commit(command);
  await services.holds.void({ tenantId: f.tenantId, holdId: f.hold.holdId });
  expect(await services.holds.commit(command)).toMatchObject({
    created: false,
    state: 'VOIDED',
    remainingAmountMinor: 0n,
  });
  expect(await services.holds.void({ tenantId: f.tenantId, holdId: f.hold.holdId })).toMatchObject({
    voided: false,
  });
  for (const state of ['HELD', 'APPLIED', 'VOIDED']) {
    await expect(
      db
        .execute(sql`update holds set state = ${state}::hold_state where id = ${f.hold.holdId}`)
        .execute(),
    ).rejects.toMatchObject({ cause: { code: 'LL001' } });
  }
  await expect(
    db
      .execute(
        sql`update holds set voided_at = voided_at + interval '1 second' where id = ${f.hold.holdId}`,
      )
      .execute(),
  ).rejects.toMatchObject({ cause: { code: 'LL001' } });
  const full = await services.holds.create({
    ...f.request,
    reference: 'second',
    entries: f.request.entries.map((e) => ({ ...e, signedAmountMinor: e.signedAmountMinor / 4n })),
  });
  await services.holds.commit({ tenantId: f.tenantId, holdId: full.holdId, reference: 'full' });
  for (const state of ['HELD', 'APPLIED', 'VOIDED']) {
    await expect(
      db
        .execute(sql`update holds set state = ${state}::hold_state where id = ${full.holdId}`)
        .execute(),
    ).rejects.toMatchObject({ cause: { code: 'LL001' } });
  }
  await expect(
    db
      .execute(
        sql`update holds set applied_at = applied_at + interval '1 second' where id = ${full.holdId}`,
      )
      .execute(),
  ).rejects.toMatchObject({ cause: { code: 'LL001' } });
});

for (const amount of [30n, 50n]) {
  it(`serializes distinct concurrent partial commits of ${amount} against a reservation of 80`, async () => {
    const f = await fixture(`parallel-partial-${amount}`);
    const concurrentClient = createDbClient({ databaseUrl, max: 2 });
    const concurrent = createApplicationServices(concurrentClient);
    try {
      const commands = ['a', 'b'].map((reference) => ({
        tenantId: f.tenantId,
        holdId: f.hold.holdId,
        reference,
        amountMinor: amount,
      }));
      const outcomes = await Promise.allSettled(
        commands.map((command) => concurrent.holds.commit(command)),
      );
      const successes = outcomes.filter((result) => result.status === 'fulfilled');
      expect(successes).toHaveLength(amount === 30n ? 2 : 1);
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({
            code: 'INVARIANT_VIOLATION',
            message: 'Unable to commit hold: amount exceeds remaining amount',
          });
        } else {
          expect(await concurrent.holds.commit(commands[index])).toMatchObject({
            created: false,
            transactionId: outcome.value.transactionId,
          });
        }
      }
      const consumed = amount * BigInt(successes.length);
      const [state] = await db.execute(
        sql`select remaining_amount_minor::text as remaining from holds where id = ${f.hold.holdId}`,
      );
      expect(state.remaining).toBe(String(80n - consumed));
      const [capacity] = await db.execute(
        sql`select remaining_minor::text as remaining, reserved_minor::text as reserved from credit_grant_capacity_versions where grant_id = ${f.grant.id} order by version desc limit 1`,
      );
      expect(capacity).toMatchObject({
        remaining: String(100n - consumed),
        reserved: String(80n - consumed),
      });
      const [postings] = await db.execute(
        sql`select count(*)::int as count from transactions where hold_id = ${f.hold.holdId}`,
      );
      expect(postings.count).toBe(successes.length);
    } finally {
      await concurrentClient.sql.end();
    }
  });
}

it('rejects a direct SQL partial commit without the matching hold remainder and rolls back all snapshots', async () => {
  const f = await fixture('missing-remainder');
  const before = await db.execute(
    sql`select * from credit_grant_capacity_versions order by version`,
  );
  await expect(
    client.runTenantTx(f.tenantId, 'direct partial commit', async (tx) => {
      const [posting] =
        await tx.execute(sql`insert into transactions(tenant_id,ledger_id,asset_id,hold_id,reference,currency)
      values (${f.tenantId},${f.ledgerId},${f.asset.id},${f.hold.holdId},'raw-partial','USD') returning id`);
      const [entry] =
        await tx.execute(sql`insert into entries(tenant_id,transaction_id,account_id,asset_id,currency,signed_amount_minor)
      values (${f.tenantId},${posting.id},${f.wallet.id},${f.asset.id},'USD',20) returning id`);
      await tx.execute(sql`insert into entries(tenant_id,transaction_id,account_id,asset_id,currency,signed_amount_minor)
      values (${f.tenantId},${posting.id},${f.funding.id},${f.asset.id},'USD',-20)`);
      await tx.execute(sql`insert into credit_grant_entries(tenant_id,ledger_id,account_id,grant_id,entry_id,kind,amount_minor)
      values (${f.tenantId},${f.ledgerId},${f.wallet.id},${f.grant.id},${entry.id},'CONSUMPTION',20)`);
    }),
  ).rejects.toMatchObject({ code: 'HOLD_LIFECYCLE_MISMATCH' });
  expect(
    await db.execute(sql`select * from credit_grant_capacity_versions order by version`),
  ).toEqual(before);
});

it('uses the invoker runtime role for valid writes and makes hidden and absent reads indistinguishable', async () => {
  const own = await fixture('own');
  const foreign = await fixture('foreign');
  const absent = '00000000-0000-4000-8000-000000000001';
  const rollback = new Error('rollback role fixture');
  await expect(
    db.transaction(async (tx) => {
      // Transactional test fixture: neither the role nor its grants survive rollback.
      await tx.execute(sql`CREATE ROLE ll101_test_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await tx.execute(sql`GRANT USAGE ON SCHEMA public TO ll101_test_runtime`);
      await tx.execute(
        sql`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ll101_test_runtime`,
      );
      await tx.execute(
        sql`GRANT UPDATE ON accounts, holds, balance_snapshots TO ll101_test_runtime`,
      );
      // PostgreSQL requires UPDATE on at least one column for SELECT FOR UPDATE.
      // Immutable-table triggers still reject actual changes to these identifiers.
      await tx.execute(sql`GRANT UPDATE (id) ON credit_grants, transactions TO ll101_test_runtime`);
      await tx.execute(sql`SET LOCAL ROLE ll101_test_runtime`);
      await tx.execute(sql`select set_config('app.tenant_id', ${own.tenantId}, true)`);
      const runtime = createApplicationServices(scopedClient(tx));
      const hiddenGrant = await publicFailure(() =>
        runtime.creditGrants.getById(foreign.tenantId, foreign.grant.id),
      );
      expect(hiddenGrant.code).toBe('CREDIT_GRANT_NOT_FOUND');
      expect(hiddenGrant).toEqual(
        await publicFailure(() => runtime.creditGrants.getById(foreign.tenantId, absent)),
      );
      const hiddenHold = await publicFailure(() =>
        runtime.holds.commit({
          tenantId: foreign.tenantId,
          holdId: foreign.hold.holdId,
          reference: 'probe',
        }),
      );
      expect(hiddenHold.code).toBe('HOLD_NOT_FOUND');
      expect(hiddenHold).toEqual(
        await publicFailure(() =>
          runtime.holds.commit({ tenantId: foreign.tenantId, holdId: absent, reference: 'probe' }),
        ),
      );
      const [snapshot] =
        await tx.execute(sql`select active_credit_grant_reservation(${foreign.tenantId},${foreign.grant.id})::text as hidden,
      active_credit_grant_reservation(${foreign.tenantId},${absent})::text as absent`);
      expect(snapshot.hidden).toBe(snapshot.absent);
      expect(snapshot.hidden).toBe('0');
      const [hiddenEntries] = await tx.execute(
        sql`select count(*)::int as count from hold_entries where hold_id = ${foreign.hold.holdId}`,
      );
      expect(hiddenEntries.count).toBe(0);
      // INVOKER permits valid INSERT; UPDATE/DELETE/TRUNCATE are denied by privileges.
      for (const table of [
        'credit_grant_hold_allocations',
        'credit_grant_entries',
        'credit_grant_capacity_versions',
        'hold_entries',
      ]) {
        for (const mutation of [
          sql`update ${sql.identifier(table)} set tenant_id = ${own.tenantId}`,
          sql`delete from ${sql.identifier(table)}`,
          sql`truncate ${sql.identifier(table)}`,
        ]) {
          await expect(
            tx.transaction(async (nested) => {
              await nested.execute(mutation);
            }),
          ).rejects.toMatchObject({ cause: { code: '42501' } });
        }
      }
      const [he] = await tx.execute(
        sql`select id from hold_entries where hold_id=${own.hold.holdId} and signed_amount_minor > 0`,
      );
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(sql`insert into credit_grant_hold_allocations(tenant_id,ledger_id,account_id,grant_id,hold_entry_id,amount_minor)
        values (${own.tenantId},${own.ledgerId},${own.wallet.id},${foreign.grant.id},${he.id},1)`);
        }),
      ).rejects.toMatchObject({
        cause: { code: 'LL003', message: 'invalid tenant-scoped allocation relationship' },
      });
      const made = await runtime.holds.create({
        ...own.request,
        reference: 'runtime',
        entries: own.request.entries.map((e) => ({
          ...e,
          signedAmountMinor: e.signedAmountMinor / 4n,
        })),
      });
      await runtime.holds.commit({
        tenantId: own.tenantId,
        holdId: made.holdId,
        reference: 'runtime-partial',
        amountMinor: 10n,
      });
      await runtime.holds.void({ tenantId: own.tenantId, holdId: made.holdId });
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  const [role] = await db.execute(
    sql`select count(*)::int as count from pg_roles where rolname = 'll101_test_runtime'`,
  );
  expect(role.count).toBe(0);
});
