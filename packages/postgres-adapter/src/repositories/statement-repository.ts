import { type AccountSide, calculateAvailableMinor, parseAccountSide } from '@luxledger/core';
import {
  AccountNotFoundError,
  type AccountStatement,
  type AccountStatementQuery,
  type CreditLotMovement,
  type CreditLotStatement,
  type CreditLotStatementQuery,
  RepositoryError,
  type StatementBalance,
  type StatementRepository,
} from '@luxledger/core/application';
import { type AnyColumn, and, desc, eq, gt, lt, lte, or, sql } from 'drizzle-orm';
import type { DbClient, DrizzleDatabase } from '../client';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';

type Tx = DrizzleDatabase;
type SnapshotRow = typeof schema.balanceSnapshots.$inferSelect & { cursorEffectiveAt: string };
type CapacityRow = {
  id: string;
  grantId: string;
  sourceEntryId: string | null;
  sourceAllocationId: string | null;
  sourceTransactionId: string | null;
  sourceHoldId: string | null;
  sourceAllocationHoldId: string | null;
  lineageKind: typeof schema.creditGrantEntries.$inferSelect.kind | null;
  version: bigint;
  remainingMinor: bigint;
  reservedMinor: bigint;
  createdAt: Date;
  cursorCreatedAt: string;
};

const INITIAL_CAPACITY_VERSION = 1n;

const exactTimestamp = (column: AnyColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export class DrizzleStatementRepository implements StatementRepository {
  public constructor(private readonly client: DbClient) {}

  public getAccountStatement(query: AccountStatementQuery): Promise<AccountStatement> {
    return this.client.runTenantTx(query.tenantId, 'get account statement', async (tx) => {
      const account = await this.account(tx, query.tenantId, query.accountId);
      const side = parseAccountSide(account.side);
      const [opening, closing, page] = await Promise.all([
        this.balanceAt(tx, query.tenantId, query.accountId, query.from, side),
        this.balanceAt(tx, query.tenantId, query.accountId, query.asOf, side),
        paginateByCursor<SnapshotRow>({
          query,
          scope: {
            resource: 'account-statement',
            tenantId: query.tenantId,
            accountId: query.accountId,
            from: query.from.toISOString(),
            asOf: query.asOf.toISOString(),
          },
          order: [
            {
              column: schema.balanceSnapshots.effectiveAt,
              key: 'effective_at',
              type: 'timestamp',
              getValue: (row) => row.cursorEffectiveAt,
            },
            {
              column: schema.balanceSnapshots.id,
              key: 'id',
              type: 'uuid',
              getValue: (row) => row.id,
            },
          ],
          selectRows: ({ cursorPredicate, limit, orderBy }) =>
            tx
              .select({
                id: schema.balanceSnapshots.id,
                tenantId: schema.balanceSnapshots.tenantId,
                ledgerId: schema.balanceSnapshots.ledgerId,
                accountId: schema.balanceSnapshots.accountId,
                eventType: schema.balanceSnapshots.eventType,
                sourceId: schema.balanceSnapshots.sourceId,
                postedMinor: schema.balanceSnapshots.postedMinor,
                reservedDeltaMinor: schema.balanceSnapshots.reservedDeltaMinor,
                effectiveAt: schema.balanceSnapshots.effectiveAt,
                createdAt: schema.balanceSnapshots.createdAt,
                cursorEffectiveAt: exactTimestamp(schema.balanceSnapshots.effectiveAt),
              })
              .from(schema.balanceSnapshots)
              .where(
                and(
                  eq(schema.balanceSnapshots.tenantId, query.tenantId),
                  eq(schema.balanceSnapshots.accountId, query.accountId),
                  gt(schema.balanceSnapshots.effectiveAt, query.from),
                  lte(schema.balanceSnapshots.effectiveAt, query.asOf),
                  cursorPredicate,
                ),
              )
              .orderBy(...orderBy)
              .limit(limit),
        }),
      ]);

      let previous = page.rows[0]
        ? await this.balanceBefore(
            tx,
            query.tenantId,
            query.accountId,
            page.rows[0].effectiveAt,
            page.rows[0].id,
          )
        : null;
      const data = page.rows.map((row) => {
        const priorPosted = previous?.postedMinor ?? 0n;
        const priorReserved = previous?.reservedDeltaMinor ?? 0n;
        const priorAvailable = calculateAvailableMinor({
          side,
          balanceMinor: priorPosted,
          reservedDeltaMinor: priorReserved,
        });
        const available = calculateAvailableMinor({
          side,
          balanceMinor: row.postedMinor,
          reservedDeltaMinor: row.reservedDeltaMinor,
        });
        const movement = {
          id: row.id,
          eventType: row.eventType,
          sourceId: row.sourceId,
          postedDeltaMinor: row.postedMinor - priorPosted,
          reservedDeltaMinor: row.reservedDeltaMinor - priorReserved,
          availableDeltaMinor: available - priorAvailable,
          effectiveAt: row.effectiveAt,
          createdAt: row.createdAt,
        };
        previous = row;
        return movement;
      });

      return {
        accountId: query.accountId,
        assetId: account.assetId,
        from: query.from,
        asOf: query.asOf,
        opening,
        closing,
        data,
        nextCursor: page.nextCursor,
      };
    });
  }

  public getCreditLotStatement(query: CreditLotStatementQuery): Promise<CreditLotStatement> {
    return this.client.runTenantTx(query.tenantId, 'get credit lot statement', async (tx) => {
      const account = await this.account(tx, query.tenantId, query.accountId);
      const predicates = [
        eq(schema.creditGrantCapacityVersions.tenantId, query.tenantId),
        eq(schema.creditGrantCapacityVersions.accountId, query.accountId),
        gt(schema.creditGrantCapacityVersions.createdAt, query.from),
        lte(schema.creditGrantCapacityVersions.createdAt, query.asOf),
      ];
      if (query.grantId) {
        predicates.push(eq(schema.creditGrantCapacityVersions.grantId, query.grantId));
      }
      const [openingAvailableMinor, closingAvailableMinor, page] = await Promise.all([
        this.creditAvailableAt(tx, query, query.from),
        this.creditAvailableAt(tx, query, query.asOf),
        paginateByCursor<CapacityRow>({
          query,
          scope: {
            resource: 'credit-lot-statement',
            tenantId: query.tenantId,
            accountId: query.accountId,
            grantId: query.grantId ?? null,
            from: query.from.toISOString(),
            asOf: query.asOf.toISOString(),
          },
          order: [
            {
              column: schema.creditGrantCapacityVersions.createdAt,
              key: 'created_at',
              type: 'timestamp',
              getValue: (row) => row.cursorCreatedAt,
            },
            {
              column: schema.creditGrantCapacityVersions.id,
              key: 'id',
              type: 'uuid',
              getValue: (row) => row.id,
            },
          ],
          selectRows: ({ cursorPredicate, limit, orderBy }) =>
            tx
              .select({
                id: schema.creditGrantCapacityVersions.id,
                grantId: schema.creditGrantCapacityVersions.grantId,
                sourceEntryId: schema.creditGrantCapacityVersions.sourceEntryId,
                sourceAllocationId: schema.creditGrantCapacityVersions.sourceAllocationId,
                sourceTransactionId: schema.entries.transactionId,
                sourceHoldId: schema.creditGrantCapacityVersions.sourceHoldId,
                sourceAllocationHoldId: schema.holdEntries.holdId,
                lineageKind: schema.creditGrantEntries.kind,
                version: schema.creditGrantCapacityVersions.version,
                remainingMinor: schema.creditGrantCapacityVersions.remainingMinor,
                reservedMinor: schema.creditGrantCapacityVersions.reservedMinor,
                createdAt: schema.creditGrantCapacityVersions.createdAt,
                cursorCreatedAt: exactTimestamp(schema.creditGrantCapacityVersions.createdAt),
              })
              .from(schema.creditGrantCapacityVersions)
              .leftJoin(
                schema.creditGrantEntries,
                and(
                  eq(schema.creditGrantEntries.grantId, schema.creditGrantCapacityVersions.grantId),
                  eq(
                    schema.creditGrantEntries.entryId,
                    schema.creditGrantCapacityVersions.sourceEntryId,
                  ),
                ),
              )
              .leftJoin(
                schema.entries,
                eq(schema.entries.id, schema.creditGrantCapacityVersions.sourceEntryId),
              )
              .leftJoin(
                schema.creditGrantHoldAllocations,
                eq(
                  schema.creditGrantHoldAllocations.id,
                  schema.creditGrantCapacityVersions.sourceAllocationId,
                ),
              )
              .leftJoin(
                schema.holdEntries,
                eq(schema.holdEntries.id, schema.creditGrantHoldAllocations.holdEntryId),
              )
              .where(and(...predicates, cursorPredicate))
              .orderBy(...orderBy)
              .limit(limit),
        }),
      ]);

      const previous = await this.previousCapacities(
        tx,
        query.tenantId,
        query.accountId,
        page.rows,
      );
      const data: CreditLotMovement[] = page.rows.map((row) => {
        const prior = previous.get(`${row.grantId}:${row.version - 1n}`);
        if (row.version < INITIAL_CAPACITY_VERSION) {
          throw new RepositoryError('Credit lot movement has an invalid capacity version');
        }
        if (row.version > INITIAL_CAPACITY_VERSION && prior === undefined) {
          throw new RepositoryError('Credit lot movement is missing its previous capacity version');
        }
        const priorAvailable = prior ? prior.remainingMinor - prior.reservedMinor : 0n;
        const availableMinor = row.remainingMinor - row.reservedMinor;
        const availableDeltaMinor = availableMinor - priorAvailable;
        const kind = this.creditLotMovementKind(row, prior, availableDeltaMinor);
        return {
          id: row.id,
          grantId: row.grantId,
          kind,
          sourceTransactionId: row.sourceTransactionId,
          sourceHoldId: row.sourceHoldId ?? row.sourceAllocationHoldId,
          availableDeltaMinor,
          remainingMinor: row.remainingMinor,
          reservedMinor: row.reservedMinor,
          availableMinor,
          effectiveAt: row.createdAt,
          createdAt: row.createdAt,
        };
      });

      return {
        accountId: query.accountId,
        assetId: account.assetId,
        grantId: query.grantId ?? null,
        from: query.from,
        asOf: query.asOf,
        openingAvailableMinor,
        closingAvailableMinor,
        data,
        nextCursor: page.nextCursor,
      };
    });
  }

  private async account(tx: Tx, tenantId: string, accountId: string) {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, accountId)))
      .limit(1);
    if (!account) throw new AccountNotFoundError(accountId);
    return account;
  }

  private async balanceAt(
    tx: Tx,
    tenantId: string,
    accountId: string,
    at: Date,
    side: AccountSide,
  ): Promise<StatementBalance> {
    const [row] = await tx
      .select({
        postedMinor: schema.balanceSnapshots.postedMinor,
        reservedDeltaMinor: schema.balanceSnapshots.reservedDeltaMinor,
      })
      .from(schema.balanceSnapshots)
      .where(
        and(
          eq(schema.balanceSnapshots.tenantId, tenantId),
          eq(schema.balanceSnapshots.accountId, accountId),
          lte(schema.balanceSnapshots.effectiveAt, at),
        ),
      )
      .orderBy(desc(schema.balanceSnapshots.effectiveAt), desc(schema.balanceSnapshots.id))
      .limit(1);
    const postedMinor = row?.postedMinor ?? 0n;
    const reservedDeltaMinor = row?.reservedDeltaMinor ?? 0n;
    return {
      postedMinor,
      reservedDeltaMinor,
      availableMinor: calculateAvailableMinor({
        side,
        balanceMinor: postedMinor,
        reservedDeltaMinor,
      }),
    };
  }

  private async balanceBefore(
    tx: Tx,
    tenantId: string,
    accountId: string,
    effectiveAt: Date,
    id: string,
  ) {
    const [row] = await tx
      .select({
        postedMinor: schema.balanceSnapshots.postedMinor,
        reservedDeltaMinor: schema.balanceSnapshots.reservedDeltaMinor,
      })
      .from(schema.balanceSnapshots)
      .where(
        and(
          eq(schema.balanceSnapshots.tenantId, tenantId),
          eq(schema.balanceSnapshots.accountId, accountId),
          or(
            lt(schema.balanceSnapshots.effectiveAt, effectiveAt),
            and(
              eq(schema.balanceSnapshots.effectiveAt, effectiveAt),
              lt(schema.balanceSnapshots.id, id),
            ),
          ),
        ),
      )
      .orderBy(desc(schema.balanceSnapshots.effectiveAt), desc(schema.balanceSnapshots.id))
      .limit(1);
    return row ?? null;
  }

  private async creditAvailableAt(
    tx: Tx,
    query: CreditLotStatementQuery,
    at: Date,
  ): Promise<bigint> {
    const predicates = [
      eq(schema.creditGrantCapacityVersions.tenantId, query.tenantId),
      eq(schema.creditGrantCapacityVersions.accountId, query.accountId),
      lte(schema.creditGrantCapacityVersions.createdAt, at),
    ];
    if (query.grantId) {
      predicates.push(eq(schema.creditGrantCapacityVersions.grantId, query.grantId));
    }
    const latest = tx
      .selectDistinctOn([schema.creditGrantCapacityVersions.grantId], {
        grantId: schema.creditGrantCapacityVersions.grantId,
        remainingMinor: schema.creditGrantCapacityVersions.remainingMinor,
        reservedMinor: schema.creditGrantCapacityVersions.reservedMinor,
      })
      .from(schema.creditGrantCapacityVersions)
      .where(and(...predicates))
      .orderBy(
        schema.creditGrantCapacityVersions.grantId,
        desc(schema.creditGrantCapacityVersions.version),
      )
      .as('statement_latest_capacity');
    const [summary] = await tx
      .select({
        available: sql<string>`coalesce(sum(${latest.remainingMinor} - ${latest.reservedMinor}), 0)::text`,
      })
      .from(latest);
    return BigInt(summary?.available ?? '0');
  }

  private creditLotMovementKind(
    row: CapacityRow,
    prior: { remainingMinor: bigint; reservedMinor: bigint } | undefined,
    availableDeltaMinor: bigint,
  ): CreditLotMovement['kind'] {
    const sourceCount = [row.sourceEntryId, row.sourceAllocationId, row.sourceHoldId].filter(
      (source) => source !== null,
    ).length;
    if (sourceCount !== 1) {
      throw new RepositoryError('Credit lot movement has invalid provenance');
    }
    if (row.sourceEntryId !== null) {
      if (row.lineageKind === null) {
        throw new RepositoryError('Credit lot movement is missing lineage provenance');
      }
      return row.lineageKind;
    }
    if (row.sourceAllocationId !== null) {
      if (row.sourceAllocationHoldId === null) {
        throw new RepositoryError('Credit lot movement is missing hold allocation provenance');
      }
      return 'HOLD_RESERVED';
    }
    if (row.sourceHoldId !== null) {
      if (
        prior === undefined ||
        availableDeltaMinor <= 0n ||
        row.reservedMinor >= prior.reservedMinor
      ) {
        throw new RepositoryError('Credit lot movement has invalid hold release provenance');
      }
      return 'HOLD_RELEASED';
    }
    throw new RepositoryError('Credit lot movement provenance is unsupported');
  }

  private async previousCapacities(
    tx: Tx,
    tenantId: string,
    accountId: string,
    rows: CapacityRow[],
  ) {
    const keys = rows.filter((row) => row.version > INITIAL_CAPACITY_VERSION);
    if (keys.length === 0)
      return new Map<string, { remainingMinor: bigint; reservedMinor: bigint }>();
    const candidates = await tx.execute<{
      grantId: string;
      version: string;
      remainingMinor: string;
      reservedMinor: string;
    }>(sql`
      select capacity.grant_id as "grantId", capacity.version::text as "version",
        capacity.remaining_minor::text as "remainingMinor",
        capacity.reserved_minor::text as "reservedMinor"
      from unnest(
        array[${sql.join(
          keys.map((row) => sql`${row.grantId}::uuid`),
          sql`, `,
        )}]::uuid[],
        array[${sql.join(
          keys.map((row) => sql`${row.version - 1n}::bigint`),
          sql`, `,
        )}]::bigint[]
      ) requested(grant_id, version)
      join credit_grant_capacity_versions capacity
        on capacity.tenant_id = ${tenantId}::uuid
        and capacity.account_id = ${accountId}::uuid
        and capacity.grant_id = requested.grant_id
        and capacity.version = requested.version
    `);
    return new Map(
      candidates.map((row) => [
        `${row.grantId}:${row.version}`,
        {
          remainingMinor: BigInt(row.remainingMinor),
          reservedMinor: BigInt(row.reservedMinor),
        },
      ]),
    );
  }
}
