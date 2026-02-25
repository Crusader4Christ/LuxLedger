import type { CreateLedgerInput, Ledger, LedgerRepository } from '@core/types';
import type { DbClient } from '@db/client';
import { toLedger } from '@db/mappers';
import { ledgers } from '@db/schema';
import { asc, eq } from 'drizzle-orm';

export class DrizzleLedgerRepository implements LedgerRepository {
  private readonly db: DbClient['db'];

  public constructor(db: DbClient['db']) {
    this.db = db;
  }

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(ledgers)
        .values({
          tenantId: input.tenantId,
          name: input.name,
        })
        .returning();

      return toLedger(created);
    });
  }

  public async findLedgerById(id: string): Promise<Ledger | null> {
    const [ledger] = await this.db.select().from(ledgers).where(eq(ledgers.id, id)).limit(1);

    if (!ledger) {
      return null;
    }

    return toLedger(ledger);
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    const rows = await this.db
      .select()
      .from(ledgers)
      .where(eq(ledgers.tenantId, tenantId))
      .orderBy(asc(ledgers.createdAt), asc(ledgers.id));

    return rows.map((row) => toLedger(row));
  }
}
