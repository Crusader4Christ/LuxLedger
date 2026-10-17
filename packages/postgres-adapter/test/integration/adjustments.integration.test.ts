import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  AdjustmentConflictError,
  OverdraftPolicyViolationError,
} from '@luxledger/core/application';
import { and, eq } from 'drizzle-orm';
import { createDbClient } from '../../src/client';
import { DrizzleAdjustmentRepository } from '../../src/repositories/adjustment-repository';
import { DrizzleCreditGrantRepository } from '../../src/repositories/credit-grant-repository';
import {
  accounts,
  balanceSnapshots,
  creditGrantEntries,
  entries,
  transactions,
} from '../../src/schema';
import {
  createAccount,
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
const repository = new DrizzleAdjustmentRepository(client);
const grants = new DrizzleCreditGrantRepository(client);

const createFixture = async () => {
  const tenantId = await createTenant(db, 'Adjustment tenant');
  const ledgerId = await createLedger(db, tenantId, 'Main');
  const accountId = await createAccount(db, {
    tenantId,
    ledgerId,
    name: 'Customer balance',
    side: 'CREDIT',
    currency: 'USD',
  });
  const offsetAccountId = await createAccount(db, {
    tenantId,
    ledgerId,
    name: 'Adjustment offset',
    side: 'DEBIT',
    currency: 'USD',
  });
  return { tenantId, ledgerId, accountId, offsetAccountId };
};

describe('operational adjustments', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it.each([
    ['CREDIT', -125n, 125n],
    ['DEBIT', 125n, -125n],
  ] as const)('posts a balanced %s with immutable audit metadata', async (direction, target, offset) => {
    const fixture = await createFixture();

    const result = await repository.create(direction, {
      ...fixture,
      reference: `adjustment-${direction.toLowerCase()}`,
      amountMinor: 125n,
      description: 'Manual support adjustment',
      reasonCode: 'SUPPORT_COMPENSATION',
      actorId: 'operator-42',
      metadata: { ticket_id: 'SUP-42' },
    });

    expect(result.created).toBeTrue();
    const [row] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, result.transactionId));
    expect(row?.description).toBe('Manual support adjustment');
    expect(row?.metadata).toEqual({
      adjustment: {
        direction,
        actor_id: 'operator-42',
        reason_code: 'SUPPORT_COMPENSATION',
        description: 'Manual support adjustment',
        reference: `adjustment-${direction.toLowerCase()}`,
        metadata: { ticket_id: 'SUP-42' },
      },
    });
    const posted = await db
      .select({ accountId: entries.accountId, amount: entries.signedAmountMinor })
      .from(entries)
      .where(eq(entries.transactionId, result.transactionId));
    expect(posted).toContainEqual({ accountId: fixture.accountId, amount: target });
    expect(posted).toContainEqual({ accountId: fixture.offsetAccountId, amount: offset });
    const snapshots = await db
      .select({ eventType: balanceSnapshots.eventType })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.sourceId, result.transactionId));
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every(({ eventType }) => eventType === 'ADJUSTMENT')).toBeTrue();
  });

  it('makes exact retries inert and rejects every changed audit or posting field', async () => {
    const fixture = await createFixture();
    const input = {
      ...fixture,
      reference: 'adjustment-retry',
      amountMinor: 100n,
      description: 'Original description',
      reasonCode: 'ORIGINAL_REASON',
      actorId: 'original-actor',
      metadata: { ticket: 'SUP-1' },
    };
    const first = await repository.create('CREDIT', input);
    const retry = await repository.create('CREDIT', input);
    expect(retry).toEqual({ transactionId: first.transactionId, created: false });

    const changedInputs = [
      ['direction', 'DEBIT', input] as const,
      ['amount', 'CREDIT', { ...input, amountMinor: 101n }] as const,
      ['description', 'CREDIT', { ...input, description: 'Changed' }] as const,
      ['reason', 'CREDIT', { ...input, reasonCode: 'CHANGED_REASON' }] as const,
      ['actor', 'CREDIT', { ...input, actorId: 'changed-actor' }] as const,
      ['metadata', 'CREDIT', { ...input, metadata: { ticket: 'SUP-2' } }] as const,
    ];
    for (const [, direction, changed] of changedInputs) {
      await expect(repository.create(direction, changed)).rejects.toBeInstanceOf(
        AdjustmentConflictError,
      );
    }

    const [target] = await db
      .select({ balance: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, fixture.accountId));
    expect(target?.balance).toBe(-100n);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('rolls back the posting when an account disallows negative natural capacity', async () => {
    const tenantId = await createTenant(db, 'Overdraft tenant');
    const ledgerId = await createLedger(db, tenantId, 'Main');
    const accountId = await createAccount(db, {
      tenantId,
      ledgerId,
      name: 'Bounded credits',
      side: 'CREDIT',
      overdraftPolicy: 'DISALLOW',
      currency: 'USD',
      balanceMinor: -50n,
    });
    const offsetAccountId = await createAccount(db, {
      tenantId,
      ledgerId,
      name: 'Offset',
      currency: 'USD',
    });

    await expect(
      repository.create('DEBIT', {
        tenantId,
        ledgerId,
        accountId,
        offsetAccountId,
        reference: 'overdraft-adjustment',
        amountMinor: 51n,
        description: 'Excess debit',
        reasonCode: 'MANUAL_DEBIT',
        actorId: 'operator',
      }),
    ).rejects.toBeInstanceOf(OverdraftPolicyViolationError);

    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await db.select().from(entries)).toHaveLength(0);
    const balances = await db
      .select({ id: accounts.id, balance: accounts.balanceMinor })
      .from(accounts);
    expect(balances).toContainEqual({ id: accountId, balance: -50n });
    expect(balances).toContainEqual({ id: offsetAccountId, balance: 0n });
  });

  it('does not cross tenant boundaries', async () => {
    const first = await createFixture();
    const secondTenantId = await createTenant(db, 'Other tenant');
    const secondLedgerId = await createLedger(db, secondTenantId, 'Other ledger');
    const secondOffsetId = await createAccount(db, {
      tenantId: secondTenantId,
      ledgerId: secondLedgerId,
      name: 'Other offset',
      currency: 'USD',
    });

    await expect(
      repository.create('CREDIT', {
        tenantId: secondTenantId,
        ledgerId: secondLedgerId,
        accountId: first.accountId,
        offsetAccountId: secondOffsetId,
        reference: 'cross-tenant',
        amountMinor: 10n,
        description: 'Invalid scope',
        reasonCode: 'TEST',
        actorId: 'operator',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('serializes concurrent exact retries to one posting', async () => {
    const fixture = await createFixture();
    const concurrentClient = createDbClient({ databaseUrl, max: 8 });
    const concurrentRepository = new DrizzleAdjustmentRepository(concurrentClient);
    const input = {
      ...fixture,
      reference: 'concurrent-adjustment',
      amountMinor: 75n,
      description: 'Concurrent retry',
      reasonCode: 'RETRY',
      actorId: 'worker',
    };
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => concurrentRepository.create('CREDIT', input)),
      );
      expect(results.filter(({ created }) => created)).toHaveLength(1);
      expect(new Set(results.map(({ transactionId }) => transactionId)).size).toBe(1);
    } finally {
      await concurrentClient.sql.end({ timeout: 5 });
    }
    const [target] = await db
      .select({ balance: accounts.balanceMinor })
      .from(accounts)
      .where(eq(accounts.id, fixture.accountId));
    expect(target?.balance).toBe(-75n);
  });

  it('uses existing grant allocation rules for a debit adjustment', async () => {
    const tenantId = await createTenant(db, 'Grant tenant');
    const ledgerId = await createLedger(db, tenantId, 'Credit ledger');
    const accountId = await createAccount(db, {
      tenantId,
      ledgerId,
      name: 'Grant wallet',
      side: 'CREDIT',
      overdraftPolicy: 'DISALLOW',
      grantEnabled: true,
      currency: 'USD',
    });
    const fundingAccountId = await createAccount(db, {
      tenantId,
      ledgerId,
      name: 'Grant funding',
      side: 'DEBIT',
      currency: 'USD',
    });
    const grant = await grants.create({
      tenantId,
      ledgerId,
      accountId,
      fundingAccountId,
      reference: 'grant-for-adjustment',
      amountMinor: 100n,
    });

    const adjustment = await repository.create('DEBIT', {
      tenantId,
      ledgerId,
      accountId,
      offsetAccountId: fundingAccountId,
      reference: 'grant-debit-adjustment',
      amountMinor: 40n,
      description: 'Operational debit',
      reasonCode: 'MANUAL_DEBIT',
      actorId: 'operator',
    });

    const lineage = await db
      .select({
        grantId: creditGrantEntries.grantId,
        kind: creditGrantEntries.kind,
        amountMinor: creditGrantEntries.amountMinor,
      })
      .from(creditGrantEntries)
      .innerJoin(entries, eq(entries.id, creditGrantEntries.entryId))
      .where(
        and(
          eq(entries.transactionId, adjustment.transactionId),
          eq(creditGrantEntries.tenantId, tenantId),
        ),
      );
    expect(lineage).toEqual([{ grantId: grant.grant.id, kind: 'CONSUMPTION', amountMinor: 40n }]);
    const balance = await grants.getBalance(tenantId, accountId);
    expect(balance.remainingMinor).toBe(60n);
    expect(balance.ledgerBalanceMinor).toBe(60n);

    await expect(
      repository.create('CREDIT', {
        tenantId,
        ledgerId,
        accountId,
        offsetAccountId: fundingAccountId,
        reference: 'grant-credit-adjustment',
        amountMinor: 10n,
        description: 'Invalid grant credit',
        reasonCode: 'MANUAL_CREDIT',
        actorId: 'operator',
      }),
    ).rejects.toBeInstanceOf(AdjustmentConflictError);

    await expect(
      repository.create('DEBIT', {
        tenantId,
        ledgerId,
        accountId: fundingAccountId,
        offsetAccountId: accountId,
        reference: 'grant-offset-debit-adjustment',
        amountMinor: 10n,
        description: 'Invalid grant offset credit',
        reasonCode: 'MANUAL_DEBIT',
        actorId: 'operator',
      }),
    ).rejects.toBeInstanceOf(AdjustmentConflictError);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });
});
