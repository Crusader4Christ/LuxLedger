import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@lux/ledger/application';
import { sql } from 'drizzle-orm';
import { DrizzleApiKeyRepository } from '../../src/repositories/api-key-repository';
import { apiKeys, tenants } from '../../src/schema';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const repository = new DrizzleApiKeyRepository(client);

describe('Drizzle API key repository', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('bootstraps the initial tenant and admin key once', async () => {
    const input = {
      tenantName: 'Initial tenant',
      keyName: 'Initial admin',
      keyHash: 'initial-admin-hash',
    };

    const first = await repository.bootstrapInitialAdmin(input);
    const second = await repository.bootstrapInitialAdmin(input);

    expect(first.created).toBeTrue();
    expect(first.tenantId).toBeDefined();
    expect(first.apiKeyId).toBeDefined();
    expect(second).toEqual({ created: false });
    expect(await db.select().from(tenants)).toHaveLength(1);
    expect(await db.select().from(apiKeys)).toHaveLength(1);
  });

  it('serializes concurrent bootstrap attempts', async () => {
    const otherClient = createRepositoryTestClient();
    const otherRepository = new DrizzleApiKeyRepository(otherClient);

    try {
      const results = await Promise.all([
        repository.bootstrapInitialAdmin({
          tenantName: 'Tenant A',
          keyName: 'Admin A',
          keyHash: 'admin-a-hash',
        }),
        otherRepository.bootstrapInitialAdmin({
          tenantName: 'Tenant B',
          keyName: 'Admin B',
          keyHash: 'admin-b-hash',
        }),
      ]);

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results.filter((result) => !result.created)).toHaveLength(1);
      expect(await db.select().from(tenants)).toHaveLength(1);
      expect(await db.select().from(apiKeys)).toHaveLength(1);
    } finally {
      await otherClient.sql.end({ timeout: 5 });
    }
  });

  it('rolls back tenant creation when API key creation fails', async () => {
    await db.execute(sql`
      CREATE FUNCTION reject_api_key_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'rejected for test' USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`
      CREATE TRIGGER reject_api_key_insert
      BEFORE INSERT ON api_keys
      FOR EACH ROW EXECUTE FUNCTION reject_api_key_insert();
    `);

    try {
      await expect(
        repository.bootstrapInitialAdmin({
          tenantName: 'Rolled back tenant',
          keyName: 'Rejected key',
          keyHash: 'rejected-key-hash',
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);

      expect(await db.select().from(tenants)).toHaveLength(0);
      expect(await db.select().from(apiKeys)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_api_key_insert ON api_keys`);
      await db.execute(sql`DROP FUNCTION reject_api_key_insert()`);
    }
  });
});
