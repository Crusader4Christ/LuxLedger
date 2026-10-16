import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { InvariantViolationError } from '@luxledger/core/application';
import type { JsonObject } from '@luxledger/core/base';
import { sql } from 'drizzle-orm';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
import {
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  createAccount as insertAccount,
  createLedger as insertLedger,
  createTenant as insertTenant,
  createTransaction as insertTransaction,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);

const transactionRepository = new DrizzleTransactionRepository(client);
const run = (query: ReturnType<typeof sql>) => db.execute(query).execute();

describe('transaction metadata database guards (LL-77 migration 0003)', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  const seed = async () => {
    const tenantId = await insertTenant(db, 'Metadata Guard Tenant');
    const ledgerId = await insertLedger(db, tenantId, 'Metadata Guard Ledger');
    return { tenantId, ledgerId };
  };

  it('adds a nullable jsonb column and leaves rows without metadata as NULL', async () => {
    const [column] = await run(sql`select data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'transactions' and column_name = 'metadata'`);
    expect(column).toEqual({ data_type: 'jsonb', is_nullable: 'YES', column_default: null });

    const { tenantId, ledgerId } = await seed();
    const transactionId = await insertTransaction(db, {
      tenantId,
      ledgerId,
      reference: 'no-metadata',
      currency: 'USD',
    });
    const [row] = await run(sql`select metadata from transactions where id = ${transactionId}`);
    expect(row?.metadata).toBeNull();
  });

  it('accepts NULL, empty, and nested object metadata but rejects non-objects in SQL', async () => {
    const { tenantId, ledgerId } = await seed();
    const objects: JsonObject[] = [{}, { nested: { list: [1, 2] } }];
    for (const [index, metadata] of objects.entries()) {
      await insertTransaction(db, {
        tenantId,
        ledgerId,
        reference: `object-${index}`,
        currency: 'USD',
        metadata,
      });
    }

    for (const [index, literal] of ['[]', '"text"', '42', 'true', 'null'].entries()) {
      await expect(
        run(sql`insert into transactions (tenant_id, ledger_id, reference, currency, asset_id, metadata)
          select ${tenantId}, ${ledgerId}, ${`raw-${index}`}, 'USD', asset_id, ${literal}::jsonb
          from transactions where reference = 'object-0'`),
      ).rejects.toMatchObject({
        cause: { code: '23514', constraint_name: 'transactions_metadata_object_chk' },
      });
    }
  });

  it('enforces the 16384-byte limit at the database boundary', async () => {
    const { tenantId, ledgerId } = await seed();
    // PostgreSQL measures jsonb::text, which adds a space after the colon.
    const overhead = '{"v": ""}'.length;
    const atLimit = { v: 'a'.repeat(16384 - overhead) };
    await insertTransaction(db, {
      tenantId,
      ledgerId,
      reference: 'at-limit',
      currency: 'USD',
      metadata: atLimit,
    });

    await expect(
      insertTransaction(db, {
        tenantId,
        ledgerId,
        reference: 'over-limit',
        currency: 'USD',
        metadata: { v: 'a'.repeat(16384 - overhead + 1) },
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'transactions_metadata_size_chk' },
    });
  });

  it('makes stored metadata immutable while allowing updates to other columns', async () => {
    const { tenantId, ledgerId } = await seed();
    const withMetadata = await insertTransaction(db, {
      tenantId,
      ledgerId,
      reference: 'immutable-set',
      currency: 'USD',
      metadata: { a: 1 },
    });
    const withoutMetadata = await insertTransaction(db, {
      tenantId,
      ledgerId,
      reference: 'immutable-null',
      currency: 'USD',
    });

    await expect(
      run(sql`update transactions set metadata = '{"a":2}'::jsonb where id = ${withMetadata}`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining('transaction metadata is immutable') },
    });
    await expect(
      run(sql`update transactions set metadata = null where id = ${withMetadata}`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining('transaction metadata is immutable') },
    });
    await expect(
      run(sql`update transactions set metadata = '{}'::jsonb where id = ${withoutMetadata}`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining('transaction metadata is immutable') },
    });

    await run(sql`update transactions set metadata = '{"a": 1}'::jsonb where id = ${withMetadata}`);
    const [row] = await run(sql`select metadata from transactions where id = ${withMetadata}`);
    expect(row?.metadata).toEqual({ a: 1 });
  });

  it('maps metadata that fits the adapter limit but exceeds the stored jsonb size to a domain error', async () => {
    const { tenantId, ledgerId } = await seed();
    const accountIds = await Promise.all(
      ['Cash', 'Revenue'].map((name) =>
        insertAccount(db, { tenantId, ledgerId, name, currency: 'USD' }),
      ),
    );
    const metadata: Record<string, number> = {};
    for (let index = 0; index < 1700; index += 1) metadata[`k${index}`] = 1;
    expect(new TextEncoder().encode(JSON.stringify(metadata)).byteLength).toBeLessThanOrEqual(
      16384,
    );

    await expect(
      transactionRepository.create({
        tenantId,
        ledgerId,
        reference: 'jsonb-text-over-limit',
        currency: 'USD',
        metadata,
        entries: [
          { accountId: accountIds[0] as string, signedAmountMinor: 1n, currency: 'USD' },
          { accountId: accountIds[1] as string, signedAmountMinor: -1n, currency: 'USD' },
        ],
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
