import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { EntryDirection } from '@luxledger/core';
import {
  BulkTransactionError,
  InvariantViolationError,
  OverdraftPolicyViolationError,
  RepositoryError,
} from '@luxledger/core/application';
import { InvalidDirectionError } from '@luxledger/core/transaction';
import { eq } from 'drizzle-orm';
import { DrizzleHoldRepository } from '../../src/repositories/hold-repository';
import { DrizzleTransactionRepository } from '../../src/repositories/transaction-repository';
import {
  accounts,
  balanceSnapshots,
  entries,
  holdEntries,
  holds,
  transactions,
} from '../../src/schema';
import {
  createAccount,
  createLedger,
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  createTenant,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const otherClient = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const holdRepository = new DrizzleHoldRepository(client);
const otherHoldRepository = new DrizzleHoldRepository(otherClient);
const transactionRepository = new DrizzleTransactionRepository(client);
const otherTransactionRepository = new DrizzleTransactionRepository(otherClient);

const setup = async (policy: 'ALLOW' | 'DISALLOW' = 'DISALLOW') => {
  const tenantId = await createTenant(db, 'Availability');
  const ledgerId = await createLedger(db, tenantId, 'Ledger');
  const spendId = await createAccount(db, {
    tenantId,
    ledgerId,
    name: 'Spend',
    currency: 'USD',
    balanceMinor: 100n,
    overdraftPolicy: policy,
    side: 'CREDIT',
  });
  const receiveId = await createAccount(db, {
    tenantId,
    ledgerId,
    name: 'Receive',
    currency: 'USD',
  });
  const request = (reference: string, amountMinor: bigint) => ({
    tenantId,
    ledgerId,
    reference,
    currency: 'USD',
    entries: [
      { accountId: spendId, direction: EntryDirection.DEBIT, amountMinor, currency: 'USD' },
      { accountId: receiveId, direction: EntryDirection.CREDIT, amountMinor, currency: 'USD' },
    ],
  });
  const state = async () => {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, spendId));
    return {
      posted: account.balanceMinor,
      debit: account.inflightDebitMinor,
      credit: account.inflightCreditMinor,
      available: account.balanceMinor - account.inflightDebitMinor + account.inflightCreditMinor,
    };
  };
  const counts = async () => ({
    holds: (await db.select().from(holds)).length,
    holdEntries: (await db.select().from(holdEntries)).length,
    transactions: (await db.select().from(transactions)).length,
    entries: (await db.select().from(entries)).length,
    snapshots: (await db.select().from(balanceSnapshots)).length,
  });
  return { tenantId, ledgerId, spendId, receiveId, request, state, counts };
};

describe('DISALLOW available balance across holds and postings', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(async () => {
    await client.sql.end({ timeout: 5 });
    await otherClient.sql.end({ timeout: 5 });
  });

  it('uses core validation for unknown directions before either repository writes', async () => {
    const f = await setup();
    const request = f.request('invalid', 10n);
    const invalid = {
      ...request,
      entries: [
        { ...request.entries[0], direction: 'INVALID' as EntryDirection },
        request.entries[1],
      ],
    };
    await expect(holdRepository.create(invalid)).rejects.toBeInstanceOf(InvalidDirectionError);
    await expect(transactionRepository.create(invalid)).rejects.toBeInstanceOf(
      InvalidDirectionError,
    );
    expect(await f.counts()).toEqual({
      holds: 0,
      holdEntries: 0,
      transactions: 0,
      entries: 0,
      snapshots: 0,
    });
  });

  it('reserves capacity, rejects a second oversized hold, and keeps retries idempotent', async () => {
    const f = await setup();
    const first = await holdRepository.create(f.request('hold-1', 70n));
    expect(first.created).toBeTrue();
    expect(await f.state()).toEqual({ posted: 100n, debit: 70n, credit: 0n, available: 30n });
    const before = await f.counts();
    await expect(holdRepository.create(f.request('hold-2', 40n))).rejects.toBeInstanceOf(
      OverdraftPolicyViolationError,
    );
    expect(await f.counts()).toEqual(before);
    expect(await f.state()).toEqual({ posted: 100n, debit: 70n, credit: 0n, available: 30n });
    expect(await holdRepository.create(f.request('hold-1', 70n))).toMatchObject({
      holdId: first.holdId,
      created: false,
    });
    expect(await f.counts()).toEqual(before);
  });

  it('prevents ordinary posting from spending held capacity and preserves posting retry', async () => {
    const f = await setup();
    await holdRepository.create(f.request('hold', 70n));
    const before = await f.counts();
    await expect(transactionRepository.create(f.request('too-large', 40n))).rejects.toBeInstanceOf(
      OverdraftPolicyViolationError,
    );
    expect(await f.counts()).toEqual(before);
    const posted = await transactionRepository.create(f.request('fits', 30n));
    expect((await transactionRepository.create(f.request('fits', 30n))).created).toBeFalse();
    expect((await transactionRepository.create(f.request('fits', 30n))).transactionId).toBe(
      posted.transactionId,
    );
    expect(await f.state()).toEqual({ posted: 70n, debit: 70n, credit: 0n, available: 0n });
  });

  it('commits its own reservation partially, then voids the rest', async () => {
    const f = await setup();
    const held = await holdRepository.create(f.request('hold', 80n));
    const committed = await holdRepository.commit({
      tenantId: f.tenantId,
      holdId: held.holdId,
      reference: 'commit',
      amountMinor: 30n,
    });
    expect(committed).toMatchObject({ created: true, state: 'HELD', remainingAmountMinor: 50n });
    expect(await f.state()).toEqual({ posted: 70n, debit: 50n, credit: 0n, available: 20n });
    expect(
      await holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'commit',
        amountMinor: 30n,
      }),
    ).toMatchObject({ created: false, transactionId: committed.transactionId });
    const before = await f.counts();
    await expect(transactionRepository.create(f.request('blocked', 21n))).rejects.toBeInstanceOf(
      OverdraftPolicyViolationError,
    );
    expect(await f.counts()).toEqual(before);
    expect(await holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId })).toMatchObject({
      voided: true,
      remainingAmountMinor: 0n,
    });
    expect(
      (await holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId })).voided,
    ).toBeFalse();
    expect(await f.state()).toEqual({ posted: 70n, debit: 0n, credit: 0n, available: 70n });
    expect((await transactionRepository.create(f.request('released', 70n))).created).toBeTrue();
  });

  it('rejects a commit retry with the same reference and a different explicit amount', async () => {
    const f = await setup();
    const held = await holdRepository.create(f.request('hold', 80n));
    const first = await holdRepository.commit({
      tenantId: f.tenantId,
      holdId: held.holdId,
      reference: 'commit',
      amountMinor: 30n,
    });
    const before = await f.counts();
    const balanceBefore = await f.state();
    await expect(
      holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'commit',
        amountMinor: 50n,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    expect(await f.state()).toEqual(balanceBefore);
    expect((await db.select().from(holds).where(eq(holds.id, held.holdId)))[0]).toMatchObject({
      state: 'HELD',
      remainingAmountMinor: 50n,
    });
    expect(
      await holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'commit',
        amountMinor: 30n,
      }),
    ).toMatchObject({ created: false, transactionId: first.transactionId });
  });

  it('releases exact mixed-direction reservations after a partial commit', async () => {
    const f = await setup();
    const held = await holdRepository.create({
      ...f.request('mixed-hold', 6n),
      entries: [
        { accountId: f.spendId, direction: EntryDirection.DEBIT, amountMinor: 6n, currency: 'USD' },
        {
          accountId: f.spendId,
          direction: EntryDirection.CREDIT,
          amountMinor: 3n,
          currency: 'USD',
        },
        {
          accountId: f.receiveId,
          direction: EntryDirection.CREDIT,
          amountMinor: 3n,
          currency: 'USD',
        },
      ],
    });
    await holdRepository.commit({
      tenantId: f.tenantId,
      holdId: held.holdId,
      reference: 'partial',
      amountMinor: 2n,
    });
    expect(await f.state()).toEqual({ posted: 99n, debit: 4n, credit: 2n, available: 97n });
    await holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId });
    expect(await f.state()).toEqual({ posted: 99n, debit: 0n, credit: 0n, available: 99n });
    const [other] = await db.select().from(accounts).where(eq(accounts.id, f.receiveId));
    expect(other.inflightDebitMinor).toBe(0n);
    expect(other.inflightCreditMinor).toBe(0n);
    expect(await f.counts()).toMatchObject({ holds: 1, transactions: 1, entries: 3, snapshots: 6 });
  });

  it('rejects a nonrepresentable partial commit and preserves the full reservation', async () => {
    const f = await setup();
    const held = await holdRepository.create({
      ...f.request('odd-hold', 5n),
      entries: [
        { accountId: f.spendId, direction: EntryDirection.DEBIT, amountMinor: 5n, currency: 'USD' },
        {
          accountId: f.spendId,
          direction: EntryDirection.CREDIT,
          amountMinor: 3n,
          currency: 'USD',
        },
        {
          accountId: f.receiveId,
          direction: EntryDirection.CREDIT,
          amountMinor: 2n,
          currency: 'USD',
        },
      ],
    });
    const before = await f.counts();
    await expect(
      holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'fractional',
        amountMinor: 2n,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    expect(await f.state()).toEqual({ posted: 100n, debit: 5n, credit: 3n, available: 98n });
    await holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId });
    expect((await f.state()).available).toBe(100n);
  });

  it('rejects a fractional per-entry commit even when account totals divide exactly', async () => {
    const f = await setup();
    const request = {
      ...f.request('split-hold', 2n),
      entries: [
        { accountId: f.spendId, direction: EntryDirection.DEBIT, amountMinor: 1n, currency: 'USD' },
        { accountId: f.spendId, direction: EntryDirection.DEBIT, amountMinor: 1n, currency: 'USD' },
        {
          accountId: f.receiveId,
          direction: EntryDirection.CREDIT,
          amountMinor: 1n,
          currency: 'USD',
        },
        {
          accountId: f.receiveId,
          direction: EntryDirection.CREDIT,
          amountMinor: 1n,
          currency: 'USD',
        },
      ],
    };
    const held = await holdRepository.create(request);
    const before = await f.counts();
    await expect(
      holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'split-commit',
        amountMinor: 1n,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    expect((await f.state()).debit).toBe(2n);
    await holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId });
    expect((await f.state()).debit).toBe(0n);
  });

  it('rejects a corrupted hold remainder above its original amount', async () => {
    const f = await setup();
    const held = await holdRepository.create(f.request('hold', 2n));
    await db.update(holds).set({ remainingAmountMinor: 3n }).where(eq(holds.id, held.holdId));
    const before = await f.counts();
    await expect(
      holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'commit',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    expect(await f.state()).toEqual({ posted: 100n, debit: 2n, credit: 0n, available: 98n });
  });

  it('rejects cross-ledger hold entries during commit and void', async () => {
    const f = await setup();
    const held = await holdRepository.create(f.request('hold', 2n));
    const otherLedgerId = await createLedger(db, f.tenantId, 'Other ledger');
    const otherAccountId = await createAccount(db, {
      tenantId: f.tenantId,
      ledgerId: otherLedgerId,
      name: 'Other account',
      currency: 'USD',
    });
    await db
      .update(holdEntries)
      .set({ accountId: otherAccountId })
      .where(eq(holdEntries.accountId, f.receiveId));
    const before = await f.counts();
    await expect(
      holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'commit',
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      holdRepository.void({ tenantId: f.tenantId, holdId: held.holdId }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    const [otherAccount] = await db.select().from(accounts).where(eq(accounts.id, otherAccountId));
    expect(otherAccount.balanceMinor).toBe(0n);
    expect(otherAccount.inflightCreditMinor).toBe(0n);
    expect((await f.state()).debit).toBe(2n);
  });

  it('rolls back an earlier account update and snapshots when a later hold account overflows', async () => {
    const f = await setup('ALLOW');
    const [firstId, secondId] = [f.spendId, f.receiveId].sort();
    await db
      .update(accounts)
      .set({ inflightCreditMinor: 9223372036854775807n })
      .where(eq(accounts.id, secondId));
    const before = await f.counts();
    await expect(
      holdRepository.create({
        ...f.request('overflow-hold', 1n),
        entries: [
          { accountId: firstId, direction: EntryDirection.DEBIT, amountMinor: 1n, currency: 'USD' },
          {
            accountId: secondId,
            direction: EntryDirection.CREDIT,
            amountMinor: 1n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(await f.counts()).toEqual(before);
    const [firstAccount] = await db.select().from(accounts).where(eq(accounts.id, firstId));
    const [secondAccount] = await db.select().from(accounts).where(eq(accounts.id, secondId));
    expect(firstAccount.inflightDebitMinor).toBe(0n);
    expect(secondAccount.inflightCreditMinor).toBe(9223372036854775807n);
  });

  it('fails closed when a corrupted hold remainder cannot be released exactly', async () => {
    const f = await setup();
    const held = await holdRepository.create({
      ...f.request('odd-hold', 5n),
      entries: [
        { accountId: f.spendId, direction: EntryDirection.DEBIT, amountMinor: 5n, currency: 'USD' },
        {
          accountId: f.spendId,
          direction: EntryDirection.CREDIT,
          amountMinor: 3n,
          currency: 'USD',
        },
        {
          accountId: f.receiveId,
          direction: EntryDirection.CREDIT,
          amountMinor: 2n,
          currency: 'USD',
        },
      ],
    });
    await db.update(holds).set({ remainingAmountMinor: 2n }).where(eq(holds.id, held.holdId));
    const before = await f.counts();
    await expect(
      holdRepository.void({
        tenantId: f.tenantId,
        holdId: held.holdId,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    expect((await f.state()).debit).toBe(5n);
  });

  it('rejects commit or void when the persisted reservation is insufficient', async () => {
    const f = await setup();
    const held = await holdRepository.create(f.request('hold', 6n));
    await db.update(accounts).set({ inflightDebitMinor: 1n }).where(eq(accounts.id, f.spendId));
    const before = await f.counts();
    await expect(
      holdRepository.commit({
        tenantId: f.tenantId,
        holdId: held.holdId,
        reference: 'commit',
        amountMinor: 2n,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(
      holdRepository.void({
        tenantId: f.tenantId,
        holdId: held.holdId,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(await f.counts()).toEqual(before);
    expect((await db.select().from(holds).where(eq(holds.id, held.holdId)))[0]).toMatchObject({
      state: 'HELD',
      remainingAmountMinor: 6n,
    });
    expect((await f.state()).debit).toBe(1n);
  });

  it('rejects negative in-flight columns at the database boundary', async () => {
    const f = await setup('ALLOW');
    await expect(
      Promise.resolve(
        db.update(accounts).set({ inflightDebitMinor: -1n }).where(eq(accounts.id, f.spendId)),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(
        db.update(accounts).set({ inflightCreditMinor: -1n }).where(eq(accounts.id, f.spendId)),
      ),
    ).rejects.toThrow();
    expect(await f.state()).toEqual({ posted: 100n, debit: 0n, credit: 0n, available: 100n });
  });

  it('serializes competing holds using separate PostgreSQL clients', async () => {
    const f = await setup();
    const results = await Promise.allSettled([
      holdRepository.create(f.request('one', 70n)),
      otherHoldRepository.create(f.request('two', 70n)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' && result.reason instanceof OverdraftPolicyViolationError,
      ),
    ).toHaveLength(1);
    expect((await f.state()).available).toBe(30n);
    expect(await f.counts()).toMatchObject({
      holds: 1,
      holdEntries: 2,
      transactions: 0,
      entries: 0,
      snapshots: 2,
    });
  });

  it('resolves simultaneous identical hold retries once across separate clients', async () => {
    const f = await setup();
    const request = f.request('same-reference', 70n);
    const [first, second] = await Promise.all([
      holdRepository.create(request),
      otherHoldRepository.create(request),
    ]);
    expect(first.holdId).toBe(second.holdId);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(await f.state()).toEqual({ posted: 100n, debit: 70n, credit: 0n, available: 30n });
    expect(await f.counts()).toMatchObject({ holds: 1, holdEntries: 2, snapshots: 2 });
  });

  it('serializes a hold against an ordinary posting using separate PostgreSQL clients', async () => {
    const f = await setup();
    const results = await Promise.allSettled([
      holdRepository.create(f.request('hold', 70n)),
      otherTransactionRepository.create(f.request('posting', 70n)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' && result.reason instanceof OverdraftPolicyViolationError,
      ),
    ).toHaveLength(1);
    expect((await f.state()).available).toBe(30n);
    const counts = await f.counts();
    expect(counts.holds + counts.transactions).toBe(1);
    expect(counts.holdEntries + counts.entries).toBe(2);
    expect(counts.snapshots).toBe(2);
  });

  it('keeps ALLOW policy permissive for both holds and postings', async () => {
    const f = await setup('ALLOW');
    await holdRepository.create(f.request('hold', 90n));
    await transactionRepository.create(f.request('posting', 90n));
    expect(await f.state()).toEqual({ posted: 10n, debit: 90n, credit: 0n, available: -80n });
  });

  it('evaluates the final per-account delta when entries share an account', async () => {
    const f = await setup();
    const netTen = {
      ...f.request('net-hold', 10n),
      entries: [
        {
          accountId: f.spendId,
          direction: EntryDirection.DEBIT,
          amountMinor: 100n,
          currency: 'USD',
        },
        {
          accountId: f.spendId,
          direction: EntryDirection.CREDIT,
          amountMinor: 90n,
          currency: 'USD',
        },
        {
          accountId: f.receiveId,
          direction: EntryDirection.CREDIT,
          amountMinor: 10n,
          currency: 'USD',
        },
      ],
    };
    await holdRepository.create(netTen);
    expect(await f.state()).toEqual({ posted: 100n, debit: 100n, credit: 90n, available: 90n });
    await transactionRepository.create({ ...netTen, reference: 'net-posting' });
    expect(await f.state()).toEqual({ posted: 90n, debit: 100n, credit: 90n, available: 80n });
    expect(
      (await db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, f.spendId)))
        .length,
    ).toBe(2);
  });

  it('rolls back a bulk posting when a later item exceeds held capacity', async () => {
    const f = await setup();
    await holdRepository.create(f.request('hold', 70n));
    const before = await f.counts();
    await expect(
      transactionRepository.createBulk({
        tenantId: f.tenantId,
        transactions: [f.request('fits', 20n), f.request('fails', 20n)],
      }),
    ).rejects.toBeInstanceOf(BulkTransactionError);
    expect(await f.counts()).toEqual(before);
    expect(await f.state()).toEqual({ posted: 100n, debit: 70n, credit: 0n, available: 30n });
    expect(
      (
        await transactionRepository.createBulk({
          tenantId: f.tenantId,
          transactions: [f.request('fits', 20n), f.request('exact', 10n)],
        })
      ).createdCount,
    ).toBe(2);
    expect((await f.state()).available).toBe(0n);
  });

  it('checks held capacity during reversal and correction without partial effects', async () => {
    const f = await setup();
    const original = await transactionRepository.create({
      ...f.request('funding', 30n),
      entries: [
        {
          accountId: f.spendId,
          direction: EntryDirection.CREDIT,
          amountMinor: 30n,
          currency: 'USD',
        },
        {
          accountId: f.receiveId,
          direction: EntryDirection.DEBIT,
          amountMinor: 30n,
          currency: 'USD',
        },
      ],
    });
    await holdRepository.create(f.request('hold', 120n));
    const before = await f.counts();
    await expect(
      transactionRepository.reverse({
        tenantId: f.tenantId,
        transactionId: original.transactionId,
        reference: 'reverse',
      }),
    ).rejects.toBeInstanceOf(OverdraftPolicyViolationError);
    expect(await f.counts()).toEqual(before);
    await expect(
      transactionRepository.correct({
        tenantId: f.tenantId,
        transactionId: original.transactionId,
        reversalReference: 'correction-reverse',
        correctedReference: 'corrected',
        entries: f.request('unused', 20n).entries,
      }),
    ).rejects.toBeInstanceOf(OverdraftPolicyViolationError);
    expect(await f.counts()).toEqual(before);
    expect((await f.state()).available).toBe(10n);
    await holdRepository.void({
      tenantId: f.tenantId,
      holdId: (await db.select().from(holds))[0].id,
    });
    expect(
      (
        await transactionRepository.reverse({
          tenantId: f.tenantId,
          transactionId: original.transactionId,
          reference: 'reverse',
        })
      ).created,
    ).toBeTrue();
  });
});
