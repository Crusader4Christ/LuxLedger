import { AccountSide, isUuidV7, parseAccountSide } from '@lux/ledger';
import {
  type BalanceApplicationRepository,
  type BalanceAtQuery,
  type BalanceHistoryQuery,
  type BalanceSnapshotEvent,
  type HistoricalBalance,
  InvariantViolationError,
  LedgerNotFoundError,
  type LedgerTrialBalanceQuery,
  type PaginatedResult,
  RepositoryError,
  type TrialBalance,
  type TrialBalanceAccount,
} from '@lux/ledger/application';
import { and, asc, desc, eq, gt, gte, lte, or, sql } from 'drizzle-orm';
import stringify from 'safe-stable-stringify';
import type { DbClient } from '../client';
import * as schema from '../schema';

export class DrizzleBalanceRepository implements BalanceApplicationRepository {
  public constructor(private readonly client: DbClient) {}

  public async getTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
    return this.client.runTenantTx(query.tenantId, 'get trial balance', async (tx) => {
      const [ledger] = await tx
        .select({ id: schema.ledgers.id })
        .from(schema.ledgers)
        .where(
          and(eq(schema.ledgers.id, query.ledgerId), eq(schema.ledgers.tenantId, query.tenantId)),
        )
        .limit(1);
      if (!ledger) {
        throw new LedgerNotFoundError(query.ledgerId);
      }

      const rows = await tx
        .select()
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.ledgerId, query.ledgerId),
            eq(schema.accounts.tenantId, query.tenantId),
          ),
        )
        .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id));

      let totalDebitsMinor = 0n;
      let totalCreditsMinor = 0n;
      const accounts: TrialBalanceAccount[] = rows.map((row) => {
        const side = parseAccountSide(row.side);
        const isDebit = row.balanceMinor < 0n;
        const isContra =
          row.balanceMinor !== 0n && (side === AccountSide.DEBIT ? !isDebit : isDebit);
        if (isDebit) {
          totalDebitsMinor += -row.balanceMinor;
        } else if (row.balanceMinor > 0n) {
          totalCreditsMinor += row.balanceMinor;
        }
        return {
          accountId: row.id,
          code: row.id,
          name: row.name,
          normalBalance: side,
          balanceMinor: isDebit ? -row.balanceMinor : row.balanceMinor,
          isContra,
        };
      });

      if (totalDebitsMinor !== totalCreditsMinor) {
        throw new RepositoryError('trial balance totals mismatch');
      }
      return {
        ledgerId: query.ledgerId,
        accounts,
        totalDebitsMinor,
        totalCreditsMinor,
      };
    });
  }

  public async getAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    return this.client.runTenantTx(query.tenantId, 'get historical balance', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.balanceSnapshots)
        .where(
          and(
            eq(schema.balanceSnapshots.tenantId, query.tenantId),
            eq(schema.balanceSnapshots.accountId, query.accountId),
            lte(schema.balanceSnapshots.effectiveAt, query.at),
          ),
        )
        .orderBy(desc(schema.balanceSnapshots.effectiveAt), desc(schema.balanceSnapshots.id))
        .limit(1);

      const postedMinor = row?.postedMinor ?? 0n;
      const inflightDebitMinor = row?.inflightDebitMinor ?? 0n;
      const inflightCreditMinor = row?.inflightCreditMinor ?? 0n;
      return {
        tenantId: query.tenantId,
        accountId: query.accountId,
        at: query.at,
        postedMinor,
        inflightDebitMinor,
        inflightCreditMinor,
        availableMinor: postedMinor - inflightDebitMinor + inflightCreditMinor,
      };
    });
  }

  public async listHistory(
    query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
    return this.client.runTenantTx(query.tenantId, 'get balance history', async (tx) => {
      const cursor = this.decodeCursor(query.cursor);
      const rows = await tx
        .select()
        .from(schema.balanceSnapshots)
        .where(
          and(
            eq(schema.balanceSnapshots.tenantId, query.tenantId),
            eq(schema.balanceSnapshots.accountId, query.accountId),
            gte(schema.balanceSnapshots.effectiveAt, query.from),
            lte(schema.balanceSnapshots.effectiveAt, query.to),
            cursor
              ? or(
                  gt(schema.balanceSnapshots.effectiveAt, cursor.effectiveAt),
                  and(
                    eq(schema.balanceSnapshots.effectiveAt, cursor.effectiveAt),
                    gt(schema.balanceSnapshots.id, cursor.id),
                  ),
                )
              : sql`true`,
          ),
        )
        .orderBy(asc(schema.balanceSnapshots.effectiveAt), asc(schema.balanceSnapshots.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const dataRows = hasMore ? rows.slice(0, query.limit) : rows;
      const data = dataRows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        ledgerId: row.ledgerId,
        accountId: row.accountId,
        eventType: row.eventType as BalanceSnapshotEvent['eventType'],
        sourceId: row.sourceId,
        postedMinor: row.postedMinor,
        inflightDebitMinor: row.inflightDebitMinor,
        inflightCreditMinor: row.inflightCreditMinor,
        effectiveAt: row.effectiveAt,
        createdAt: row.createdAt,
      }));
      const last = data.at(-1);
      return {
        data,
        nextCursor: hasMore && last ? this.encodeCursor(last.effectiveAt, last.id) : null,
      };
    });
  }

  private encodeCursor(effectiveAt: Date, id: string): string {
    const serialized = stringify({
      effectiveAt: effectiveAt.toISOString(),
      id,
    });
    if (serialized === undefined) {
      throw new InvariantViolationError('Invalid cursor');
    }
    return Buffer.from(serialized, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string | undefined): { effectiveAt: Date; id: string } | null {
    if (!cursor) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (
        typeof parsed.effectiveAt !== 'string' ||
        typeof parsed.id !== 'string' ||
        !isUuidV7(parsed.id)
      ) {
        throw new InvariantViolationError('Invalid cursor');
      }
      const effectiveAt = new Date(parsed.effectiveAt);
      if (Number.isNaN(effectiveAt.getTime())) {
        throw new InvariantViolationError('Invalid cursor');
      }
      return { effectiveAt, id: parsed.id };
    } catch {
      throw new InvariantViolationError('Invalid cursor');
    }
  }
}
