import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@lux/ledger/application';
import { sql } from 'drizzle-orm';
import { tenants } from '../../src/schema';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);

describe('DbClient transactions', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('runTx rolls back writes when the action fails', async () => {
    await expect(
      client.runTx('rollback test', async (tx) => {
        await tx.insert(tenants).values({ name: 'Rolled back' });
        throw new InvariantViolationError('rollback');
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);

    expect(await db.select().from(tenants)).toHaveLength(0);
  });

  it('runTenantTx sets tenant context only inside the transaction', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    const context = await client.runTenantTx(tenantId, 'tenant context test', async (tx) => {
      const result = await tx.execute(
        sql<{ tenantId: string }>`select current_setting('app.tenant_id') as "tenantId"`,
      );
      return result[0]?.tenantId;
    });

    expect(context).toBe(tenantId);

    const outside = await db.execute(
      sql<{ tenantId: string | null }>`select current_setting('app.tenant_id', true) as "tenantId"`,
    );
    expect(outside[0]?.tenantId || null).toBeNull();
  });
});
