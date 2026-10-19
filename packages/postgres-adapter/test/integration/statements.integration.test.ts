import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AccountSide } from '@luxledger/core';
import { AccountNotFoundError, RepositoryError } from '@luxledger/core/application';
import { sql } from 'drizzle-orm';
import { createApplicationServices } from '../../src/application-services';
import {
  createLedger,
  createRepositoryTestClient,
  createRepositoryTestDatabase,
  createTenant,
  migrateTestDatabase,
  truncateTestDatabase,
} from './repository-test-support';

const client = createRepositoryTestClient();
const db = createRepositoryTestDatabase(client);
const services = createApplicationServices(client);

const databaseTime = async (): Promise<Date> => {
  const [row] = await db.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  if (!row) throw new Error('Database clock unavailable');
  return new Date(row.now);
};

const setup = async (tenantId: string) => {
  const ledgerId = await createLedger(db, tenantId, 'Statement ledger');
  const asset = (await services.assets.list(tenantId)).find((item) => item.code === 'USD');
  if (!asset) throw new Error('Missing USD asset');
  const wallet = await services.accounts.create({
    tenantId,
    ledgerId,
    name: 'Wallet',
    side: AccountSide.CREDIT,
    overdraftPolicy: 'DISALLOW',
    grantEnabled: true,
    currency: 'USD',
    assetId: asset.id,
  });
  const funding = await services.accounts.create({
    tenantId,
    ledgerId,
    name: 'Funding',
    side: AccountSide.DEBIT,
    currency: 'USD',
    assetId: asset.id,
  });
  return { ledgerId, assetId: asset.id, walletId: wallet.id, fundingId: funding.id };
};

describe('bounded statements', () => {
  beforeAll(() => migrateTestDatabase(db));
  beforeEach(() => truncateTestDatabase(db));
  afterAll(() => client.sql.end({ timeout: 5 }));

  it('reconciles paged ledger and grant-lot movements through a fixed as-of boundary', async () => {
    const tenantId = await createTenant(db, 'statement-reconcile');
    const accounts = await setup(tenantId);
    const from = new Date('2020-01-01T00:00:00.000Z');
    const issued = await services.creditGrants.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.walletId,
      fundingAccountId: accounts.fundingId,
      reference: 'statement-grant',
      amountMinor: 100n,
    });
    const consumed = await services.transactions.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'statement-consume',
      currency: 'USD',
      entries: [
        { accountId: accounts.walletId, signedAmountMinor: 25n, currency: 'USD' },
        { accountId: accounts.fundingId, signedAmountMinor: -25n, currency: 'USD' },
      ],
    });
    await services.holds.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'statement-hold',
      currency: 'USD',
      entries: [
        { accountId: accounts.walletId, signedAmountMinor: 15n, currency: 'USD' },
        { accountId: accounts.fundingId, signedAmountMinor: -15n, currency: 'USD' },
      ],
    });
    await services.transactions.reverse({
      tenantId,
      transactionId: consumed.transactionId,
      reference: 'statement-consume-reversal',
    });
    await services.adjustments.debit({
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.walletId,
      offsetAccountId: accounts.fundingId,
      reference: 'statement-adjustment',
      amountMinor: 5n,
      description: 'Audited statement adjustment',
      reasonCode: 'STATEMENT_TEST',
      actorId: 'test-operator',
    });
    await services.creditGrants.refund({
      tenantId,
      grantId: issued.grant.id,
      reference: 'statement-refund',
      amountMinor: 10n,
    });
    const expiryClock = await databaseTime();
    await services.creditGrants.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.walletId,
      fundingAccountId: accounts.fundingId,
      reference: 'statement-expiring-grant',
      amountMinor: 20n,
      expiresAt: new Date(expiryClock.getTime() + 10),
    });
    await Bun.sleep(20);
    await services.creditGrants.runExpirations({
      tenantId,
      asOf: await databaseTime(),
      limit: 10,
    });
    const asOf = await databaseTime();

    const ledgerMovements = [];
    let ledgerCursor: string | undefined;
    let firstLedgerPage:
      | Awaited<ReturnType<typeof services.statements.getAccountStatement>>
      | undefined;
    do {
      const page = await services.statements.getAccountStatement({
        tenantId,
        accountId: accounts.walletId,
        from,
        asOf,
        limit: 1,
        cursor: ledgerCursor,
      });
      firstLedgerPage ??= page;
      ledgerMovements.push(...page.data);
      ledgerCursor = page.nextCursor ?? undefined;
    } while (ledgerCursor);
    if (!firstLedgerPage) throw new Error('Missing statement page');
    expect(ledgerMovements.map((item) => item.eventType)).toContain('HOLD_CREATED');
    expect(ledgerMovements.map((item) => item.eventType)).toContain('ADJUSTMENT');
    expect(ledgerMovements.reduce((sum, item) => sum + item.postedDeltaMinor, 0n)).toBe(
      firstLedgerPage.closing.postedMinor - firstLedgerPage.opening.postedMinor,
    );
    expect(ledgerMovements.reduce((sum, item) => sum + item.reservedDeltaMinor, 0n)).toBe(
      firstLedgerPage.closing.reservedDeltaMinor - firstLedgerPage.opening.reservedDeltaMinor,
    );
    expect(ledgerMovements.reduce((sum, item) => sum + item.availableDeltaMinor, 0n)).toBe(
      firstLedgerPage.closing.availableMinor - firstLedgerPage.opening.availableMinor,
    );

    const lotMovements = [];
    let lotCursor: string | undefined;
    let firstLotPage:
      | Awaited<ReturnType<typeof services.statements.getCreditLotStatement>>
      | undefined;
    do {
      const page = await services.statements.getCreditLotStatement({
        tenantId,
        accountId: accounts.walletId,
        from,
        asOf,
        limit: 1,
        cursor: lotCursor,
      });
      firstLotPage ??= page;
      lotMovements.push(...page.data);
      lotCursor = page.nextCursor ?? undefined;
    } while (lotCursor);
    if (!firstLotPage) throw new Error('Missing credit statement page');
    const kinds = lotMovements.map((item) => item.kind);
    expect(kinds).toContain('ISSUANCE');
    expect(kinds).toContain('CONSUMPTION');
    expect(kinds).toContain('HOLD_RESERVED');
    expect(kinds).toContain('COMPENSATION');
    expect(kinds).toContain('REFUND');
    expect(kinds).toContain('EXPIRATION');
    expect(lotMovements.reduce((sum, item) => sum + item.availableDeltaMinor, 0n)).toBe(
      firstLotPage.closingAvailableMinor - firstLotPage.openingAvailableMinor,
    );
  });

  it('classifies hold reservation, partial consumption, and release without overlap', async () => {
    const tenantId = await createTenant(db, 'statement-hold-provenance');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.walletId,
      fundingAccountId: accounts.fundingId,
      reference: 'statement-hold-grant',
      amountMinor: 100n,
    });
    const hold = await services.holds.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      reference: 'statement-hold-reserve',
      currency: 'USD',
      entries: [
        { accountId: accounts.walletId, signedAmountMinor: 40n, currency: 'USD' },
        { accountId: accounts.fundingId, signedAmountMinor: -40n, currency: 'USD' },
      ],
    });
    const commit = await services.holds.commit({
      tenantId,
      holdId: hold.holdId,
      reference: 'statement-hold-partial-commit',
      amountMinor: 15n,
    });
    await services.holds.void({ tenantId, holdId: hold.holdId });

    const statement = await services.statements.getCreditLotStatement({
      tenantId,
      accountId: accounts.walletId,
      grantId: grant.grant.id,
      from: new Date('2020-01-01T00:00:00.000Z'),
      asOf: await databaseTime(),
      limit: 20,
    });

    expect(statement.data).toHaveLength(4);
    expect(statement.data.map((movement) => movement.kind)).toEqual([
      'ISSUANCE',
      'HOLD_RESERVED',
      'CONSUMPTION',
      'HOLD_RELEASED',
    ]);
    expect(statement.data[1]).toMatchObject({
      sourceHoldId: hold.holdId,
      availableDeltaMinor: -40n,
    });
    expect(statement.data[2]).toMatchObject({
      sourceTransactionId: commit.transactionId,
      availableDeltaMinor: 0n,
    });
    expect(statement.data[3]).toMatchObject({
      sourceHoldId: hold.holdId,
      availableDeltaMinor: 25n,
    });
    expect(statement.closingAvailableMinor).toBe(85n);
  });

  it('fails closed when a capacity version has no classifiable provenance', async () => {
    const tenantId = await createTenant(db, 'statement-invalid-provenance');
    const accounts = await setup(tenantId);
    const grant = await services.creditGrants.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.walletId,
      fundingAccountId: accounts.fundingId,
      reference: 'statement-invalid-provenance-grant',
      amountMinor: 100n,
    });
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`alter table credit_grant_capacity_versions disable trigger credit_grant_capacity_baseline_guard`,
      );
      await tx.execute(sql`
        insert into credit_grant_capacity_versions (
          tenant_id, ledger_id, account_id, grant_id, version,
          granted_minor, reversed_minor, consumed_minor, compensated_minor,
          expired_minor, remaining_minor, reserved_minor
        )
        select tenant_id, ledger_id, account_id, grant_id, version + 1,
          granted_minor, reversed_minor, consumed_minor, compensated_minor,
          expired_minor, remaining_minor, reserved_minor
        from credit_grant_capacity_versions
        where tenant_id = ${tenantId} and grant_id = ${grant.grant.id}
        order by version desc
        limit 1
      `);
      await tx.execute(
        sql`alter table credit_grant_capacity_versions enable trigger credit_grant_capacity_baseline_guard`,
      );
    });

    await expect(
      services.statements.getCreditLotStatement({
        tenantId,
        accountId: accounts.walletId,
        grantId: grant.grant.id,
        from: new Date('2020-01-01T00:00:00.000Z'),
        asOf: await databaseTime(),
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it('keeps an empty range stable, excludes later writes, and isolates tenants', async () => {
    const tenantId = await createTenant(db, 'statement-boundary');
    const otherTenantId = await createTenant(db, 'statement-other');
    const accounts = await setup(tenantId);
    for (const reference of ['before-boundary-1', 'before-boundary-2']) {
      await services.creditGrants.create({
        tenantId,
        ledgerId: accounts.ledgerId,
        accountId: accounts.walletId,
        fundingAccountId: accounts.fundingId,
        reference,
        amountMinor: 25n,
      });
    }
    const boundary = await databaseTime();
    const firstPage = await services.statements.getCreditLotStatement({
      tenantId,
      accountId: accounts.walletId,
      from: new Date('2020-01-01T00:00:00.000Z'),
      asOf: boundary,
      limit: 1,
    });
    expect(firstPage.nextCursor).not.toBeNull();
    await services.creditGrants.create({
      tenantId,
      ledgerId: accounts.ledgerId,
      accountId: accounts.walletId,
      fundingAccountId: accounts.fundingId,
      reference: 'after-boundary',
      amountMinor: 50n,
    });

    const ledger = await services.statements.getAccountStatement({
      tenantId,
      accountId: accounts.walletId,
      from: boundary,
      asOf: boundary,
      limit: 10,
    });
    expect(ledger.data).toEqual([]);
    expect(ledger.opening).toEqual(ledger.closing);

    const lots = await services.statements.getCreditLotStatement({
      tenantId,
      accountId: accounts.walletId,
      from: boundary,
      asOf: boundary,
      limit: 10,
    });
    expect(lots.data).toEqual([]);
    expect(lots.openingAvailableMinor).toBe(lots.closingAvailableMinor);

    const rest = await services.statements.getCreditLotStatement({
      tenantId,
      accountId: accounts.walletId,
      from: new Date('2020-01-01T00:00:00.000Z'),
      asOf: boundary,
      limit: 10,
      cursor: firstPage.nextCursor as string,
    });
    expect([...firstPage.data, ...rest.data]).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();

    await expect(
      services.statements.getAccountStatement({
        tenantId: otherTenantId,
        accountId: accounts.walletId,
        from: boundary,
        asOf: boundary,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});
