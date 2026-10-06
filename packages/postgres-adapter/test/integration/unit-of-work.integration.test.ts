import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AccountSide, TenantId } from '@luxledger/core';
import { createDbClient, createUnitOfWork } from '@luxledger/postgres-adapter';
import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { transactions } from '../../src/schema';
import {
  createRepositoryTestDatabase,
  createTenant,
  databaseUrl,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const hostOutbox = pgTable(
  'host_outbox',
  {
    tenantId: uuid('tenant_id').notNull(),
    reference: text('reference').notNull(),
    payload: text('payload').notNull(),
  },
  (table) => ({
    tenantReferenceUq: uniqueIndex('host_outbox_tenant_reference_uq').on(
      table.tenantId,
      table.reference,
    ),
  }),
);

const client = createDbClient({
  databaseUrl,
  max: 2,
  idleTimeoutSeconds: 5,
  connectTimeoutSeconds: 5,
  hostSchema: { hostOutbox },
});
const db = createRepositoryTestDatabase(client);
const unitOfWork = createUnitOfWork(client);

const createPosting = async (tenantId: TenantId, reference: string, outboxPayload: string) =>
  unitOfWork.run(tenantId, async ({ tx, services }) => {
    const ledger = await services.ledgers.create({ tenantId: tenantId.value, name: 'Host ledger' });
    const debit = await services.accounts.create({
      tenantId: tenantId.value,
      ledgerId: ledger.id,
      name: 'Debit',
      side: AccountSide.DEBIT,
      currency: 'USD',
    });
    const credit = await services.accounts.create({
      tenantId: tenantId.value,
      ledgerId: ledger.id,
      name: 'Credit',
      side: AccountSide.CREDIT,
      currency: 'USD',
    });
    await tx.insert(hostOutbox).values({
      tenantId: tenantId.value,
      reference,
      payload: outboxPayload,
    });
    const storedOutbox = await tx.query.hostOutbox.findFirst({
      where: (outbox, { and, eq }) =>
        and(eq(outbox.tenantId, tenantId.value), eq(outbox.reference, reference)),
    });
    if (!storedOutbox) {
      throw new Error('Host outbox row was not visible inside the unit of work');
    }
    return services.transactions.create({
      tenantId: tenantId.value,
      ledgerId: ledger.id,
      reference,
      currency: 'USD',
      entries: [
        {
          accountId: debit.id,
          signedAmountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: credit.id,
          signedAmountMinor: -100n,
          currency: 'USD',
        },
      ],
    });
  });

const readOutbox = (tenantId: string) =>
  client.runTenantTx(tenantId, 'read host outbox', (tx) =>
    tx.query.hostOutbox.findMany({
      columns: { reference: true, payload: true },
      orderBy: (outbox, { asc }) => [asc(outbox.reference)],
    }),
  );

describe('PostgresUnitOfWork', () => {
  beforeAll(async () => {
    await migrateTestDatabase(db);
    await db.execute(sql`
      create table host_outbox (
        id bigint generated always as identity primary key,
        tenant_id uuid not null references tenants(id),
        reference text not null,
        payload text not null,
        unique (tenant_id, reference)
      )
    `);
    await db.execute(sql`alter table host_outbox enable row level security`);
    await db.execute(sql`alter table host_outbox force row level security`);
    await db.execute(sql`
      create policy host_outbox_tenant_rls on host_outbox
      using (tenant_id::text = current_setting('app.tenant_id', true))
      with check (tenant_id::text = current_setting('app.tenant_id', true))
    `);
  });
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('commits host outbox and ledger posting in one transaction', async () => {
    const tenantId = new TenantId(await createTenant(db, 'Commit tenant'));

    const result = await createPosting(tenantId, 'host-commit', 'purchase.created');

    expect(result.created).toBeTrue();
    expect(Array.from(await readOutbox(tenantId.value))).toEqual([
      { reference: 'host-commit', payload: 'purchase.created' },
    ]);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('rolls back ledger changes when host work fails', async () => {
    const tenantId = new TenantId(await createTenant(db, 'Host failure tenant'));
    const hostError = new Error('host callback failed');

    await expect(
      unitOfWork.run(tenantId, async ({ services }) => {
        await services.ledgers.create({ tenantId: tenantId.value, name: 'Rolled back ledger' });
        throw hostError;
      }),
    ).rejects.toBe(hostError);

    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await servicesLedgerCount(tenantId.value)).toBe(0);
  });

  it('rolls back host work when ledger validation fails', async () => {
    const tenantId = new TenantId(await createTenant(db, 'Ledger failure tenant'));

    await expect(
      unitOfWork.run(tenantId, async ({ tx, services }) => {
        await tx.insert(hostOutbox).values({
          tenantId: tenantId.value,
          reference: 'ledger-failure',
          payload: 'must roll back',
        });
        await services.transactions.create({
          tenantId: tenantId.value,
          ledgerId: 'missing-ledger',
          reference: 'ledger-failure',
          currency: 'USD',
          entries: [],
        });
      }),
    ).rejects.toThrow('transaction must have at least 2 entries');

    expect(await readOutbox(tenantId.value)).toHaveLength(0);
  });

  it('keeps transaction retries idempotent with a host upsert', async () => {
    const tenantId = new TenantId(await createTenant(db, 'Retry tenant'));
    const setup = await unitOfWork.run(tenantId, async ({ services }) => {
      const ledger = await services.ledgers.create({
        tenantId: tenantId.value,
        name: 'Retry ledger',
      });
      const debit = await services.accounts.create({
        tenantId: tenantId.value,
        ledgerId: ledger.id,
        name: 'Debit',
        side: AccountSide.DEBIT,
        currency: 'USD',
      });
      const credit = await services.accounts.create({
        tenantId: tenantId.value,
        ledgerId: ledger.id,
        name: 'Credit',
        side: AccountSide.CREDIT,
        currency: 'USD',
      });
      return { ledgerId: ledger.id, debitId: debit.id, creditId: credit.id };
    });

    const attempt = () =>
      unitOfWork.run(tenantId, async ({ tx, services }) => {
        await tx
          .insert(hostOutbox)
          .values({
            tenantId: tenantId.value,
            reference: 'host-retry',
            payload: 'first attempt',
          })
          .onConflictDoNothing({ target: [hostOutbox.tenantId, hostOutbox.reference] });
        return services.transactions.create({
          tenantId: tenantId.value,
          ledgerId: setup.ledgerId,
          reference: 'host-retry',
          currency: 'USD',
          entries: [
            {
              accountId: setup.debitId,
              signedAmountMinor: 100n,
              currency: 'USD',
            },
            {
              accountId: setup.creditId,
              signedAmountMinor: -100n,
              currency: 'USD',
            },
          ],
        });
      });

    const first = await attempt();
    const second = await attempt();

    expect(first.created).toBeTrue();
    expect(second.created).toBeFalse();
    expect(await readOutbox(tenantId.value)).toHaveLength(1);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('rejects nested and cross-tenant service work without leaking writes', async () => {
    const tenantId = new TenantId(await createTenant(db, 'Scope tenant'));
    const otherTenantId = await createTenant(db, 'Other tenant');

    await expect(
      unitOfWork.run(tenantId, async () => unitOfWork.run(tenantId, async () => undefined)),
    ).rejects.toThrow('Nested unit of work is not supported');

    await expect(
      unitOfWork.run(tenantId, ({ services }) =>
        services.ledgers.create({ tenantId: otherTenantId, name: 'Wrong tenant' }),
      ),
    ).rejects.toThrow('Unit of work tenant does not match operation tenant');

    expect(await servicesLedgerCount(tenantId.value)).toBe(0);
    expect(await servicesLedgerCount(otherTenantId)).toBe(0);
  });

  it('provides tenant RLS context to host SQL and rejects unscoped service work', async () => {
    const tenantId = new TenantId(await createTenant(db, 'RLS tenant'));

    const contextTenantId = await unitOfWork.run(tenantId, async ({ tx }) => {
      const [row] = await tx.execute(
        sql<{ tenantId: string }>`select current_setting('app.tenant_id') as "tenantId"`,
      );
      return row?.tenantId;
    });

    expect(contextTenantId).toBe(tenantId.value);

    await expect(
      unitOfWork.run(tenantId, ({ services }) =>
        services.apiKeys.bootstrapInitialAdmin({
          tenantName: 'Not tenant scoped',
          keyName: 'Admin',
          rawApiKey: 'not-used',
        }),
      ),
    ).rejects.toThrow('Unscoped operation is not allowed in a tenant unit of work');

    expect(await readOutbox(tenantId.value)).toHaveLength(0);
  });

  it('allows concurrent top-level units of work on one instance', async () => {
    const tenantId = new TenantId(await createTenant(db, 'Concurrent tenant'));

    const references = await Promise.all(
      ['concurrent-a', 'concurrent-b'].map((reference) =>
        unitOfWork.run(tenantId, async ({ tx }) => {
          await tx.insert(hostOutbox).values({
            tenantId: tenantId.value,
            reference,
            payload: 'concurrent',
          });
          return reference;
        }),
      ),
    );

    expect(references.sort()).toEqual(['concurrent-a', 'concurrent-b']);
    expect(await readOutbox(tenantId.value)).toHaveLength(2);
  });
});

const servicesLedgerCount = (tenantId: string) =>
  client.runTenantTx(tenantId, 'count ledgers', async (tx) => {
    const rows = await tx.execute(
      sql<{ count: string }>`select count(*)::text as count from ledgers`,
    );
    return Number(rows[0]?.count ?? 0);
  });
