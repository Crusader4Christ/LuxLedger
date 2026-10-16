import { sql } from 'drizzle-orm';
import { createApplicationServices } from '../packages/postgres-adapter/src/application-services';
import type { DbClient } from '../packages/postgres-adapter/src/client';
import {
  availableCapacityByGrant,
  type GrantCapacityRow,
  grantCapacityQuery,
} from '../packages/postgres-adapter/src/repositories/grant-capacity-query';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
} from '../packages/postgres-adapter/test/integration/repository-test-support';

// No reset, trigger bypass or persisted benchmark records. Use an already migrated,
// dedicated test database; all fixture writes and ANALYZE changes are rolled back.
if (!process.env.DATABASE_URL_TEST) throw new Error('Explicit DATABASE_URL_TEST is required');
const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const rollback = new Error('Rollback profiling fixture');
type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  Plans?: PlanNode[];
};
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '120s'`);
    const [tenant] = await tx.execute<{ id: string }>(
      sql`insert into tenants(name) values ('reservation-profile') returning id`,
    );
    const tenantId = tenant.id;
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`insert into assets(tenant_id,code,scale) values (${tenantId},'USD',2)`);
    const [ledger] = await tx.execute<{ id: string }>(
      sql`insert into ledgers(tenant_id,name) values (${tenantId},'Profile') returning id`,
    );
    const ledgerId = ledger.id;
    const bound: DbClient = {
      sql: client.sql,
      execute: (operation, action) => client.execute(operation, () => action(tx)),
      runTx: (operation, action) => client.execute(operation, () => action(tx)),
      runTenantTx: (_tenant, operation, action) => client.execute(operation, () => action(tx)),
    };
    const services = createApplicationServices(bound);
    const asset = (await services.assets.list(tenantId))[0];
    const funding = await services.accounts.create({
      tenantId,
      ledgerId,
      assetId: asset.id,
      name: 'Funding',
      currency: 'USD',
      side: 'DEBIT',
    });
    // Generate valid, balanced consumption postings with the production triggers enabled.
    await tx.execute(sql`create function pg_temp.seed_consumptions(p_tenant uuid, p_ledger uuid,
      p_asset uuid, p_account uuid, p_funding uuid, p_grant uuid, p_count integer)
      returns void language plpgsql as $$
      declare posting uuid; debit uuid;
      begin
        for i in 1..p_count loop
          insert into transactions(tenant_id,ledger_id,asset_id,reference,currency)
            values(p_tenant,p_ledger,p_asset,p_grant::text || ':' || i,'USD') returning id into posting;
          insert into entries(tenant_id,transaction_id,account_id,asset_id,currency,signed_amount_minor)
            values(p_tenant,posting,p_account,p_asset,'USD',1) returning id into debit;
          insert into entries(tenant_id,transaction_id,account_id,asset_id,currency,signed_amount_minor)
            values(p_tenant,posting,p_funding,p_asset,'USD',-1);
          insert into credit_grant_entries(tenant_id,ledger_id,account_id,grant_id,entry_id,kind,amount_minor)
            values(p_tenant,p_ledger,p_account,p_grant,debit,'CONSUMPTION',1);
        end loop;
      end $$`);
    for (const scenario of [
      { name: 'deep', grants: 1, versions: 10_000 },
      { name: 'wide', grants: 1_000, versions: 10 },
    ]) {
      const account = await services.accounts.create({
        tenantId,
        ledgerId,
        assetId: asset.id,
        name: scenario.name,
        currency: 'USD',
        side: 'CREDIT',
        overdraftPolicy: 'DISALLOW',
        grantEnabled: true,
      });
      const ids: string[] = [];
      for (let i = 0; i < scenario.grants; i++) {
        const { grant } = await services.creditGrants.create({
          tenantId,
          ledgerId,
          accountId: account.id,
          fundingAccountId: funding.id,
          reference: `${scenario.name}:${i}`,
          amountMinor: BigInt(scenario.versions + 100),
        });
        ids.push(grant.id);
        await tx.execute(
          sql`select pg_temp.seed_consumptions(${tenantId},${ledgerId},${asset.id},${account.id},${funding.id},${grant.id},${scenario.versions})`,
        );
        if (i % 100 === 0)
          console.log(`Seeded ${scenario.name}: ${i + 1}/${scenario.grants} grants`);
      }
      await services.holds.create({
        tenantId,
        ledgerId,
        reference: `${scenario.name}:hold`,
        currency: 'USD',
        entries: [
          { accountId: account.id, currency: 'USD', signedAmountMinor: 50n },
          { accountId: funding.id, currency: 'USD', signedAmountMinor: -50n },
        ],
      });
      await tx.execute(sql`set constraints all immediate`);
      await tx.execute(sql`set constraints all deferred`);
      await tx.execute(sql`analyze credit_grant_capacity_versions`);
      const requested = sql`array[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]`;
      const latest = sql`select remaining_minor - reserved_minor as available from credit_grant_capacity_versions
        where tenant_id = ${tenantId} and grant_id = ${ids[0]} order by version desc limit 1`;
      const batch = sql`select distinct on (grant_id) grant_id, remaining_minor, reserved_minor
        from credit_grant_capacity_versions where tenant_id = ${tenantId} and grant_id = any(${requested})
        order by grant_id, version desc`;
      const [count] = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from credit_grant_capacity_versions where tenant_id = ${tenantId} and account_id = ${account.id}`,
      );
      if (count.count < 10_000) throw new Error('Profiling fixture is too small');
      const [capacity] = await tx.execute(latest);
      if (String(capacity.available) !== '50')
        throw new Error('Incorrect latest reservation subtraction');
      const boundedBatch = grantCapacityQuery(tenantId, ids);
      const capacities = await tx.execute<GrantCapacityRow>(boundedBatch);
      const availableByGrant = availableCapacityByGrant(capacities);
      if (
        capacities.length !== ids.length ||
        [...availableByGrant.values()].reduce((total, value) => total + value, 0n) !==
          BigInt(ids.length * 100 - 50)
      ) {
        throw new Error('Incorrect batch reservation subtraction');
      }
      for (const [label, query] of [
        ['latest', latest],
        ['baseline-distinct', batch],
        ['batch', boundedBatch],
      ] as const) {
        const plan = await tx.execute<{
          'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number }>;
        }>(sql`explain (analyze, buffers, format json) ${query}`);
        const nodes = flatten(plan[0]['QUERY PLAN'][0].Plan).filter(
          (node) => node['Relation Name'] === 'credit_grant_capacity_versions',
        );
        const versionRowsRead = nodes.reduce(
          (total, node) => total + node['Actual Rows'] * node['Actual Loops'],
          0,
        );
        if (
          label !== 'baseline-distinct' &&
          (nodes.length === 0 ||
            nodes.some((node) => !node['Node Type'].includes('Index')) ||
            versionRowsRead > (label === 'latest' ? 1 : ids.length))
        ) {
          throw new Error('Latest capacity lookup regressed to scanning historical versions');
        }
        console.log(
          JSON.stringify({
            scenario: scenario.name,
            versions: count.count,
            query: label,
            versionRowsRead,
            executionMs: plan[0]['QUERY PLAN'][0]['Execution Time'],
            plan: plan[0]['QUERY PLAN'],
          }),
        );
      }
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await client.sql.end();
}
