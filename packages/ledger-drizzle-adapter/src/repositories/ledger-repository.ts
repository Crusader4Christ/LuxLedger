import type { LedgerEntity } from '@lux/ledger';
import type { CreateLedgerInput, LedgerRepository } from '@lux/ledger/application';
import { and, asc, eq } from 'drizzle-orm';
import type { DbClient } from '../client';
import { toLedgerEntity } from '../mappers/ledger-mapper';
import * as schema from '../schema';

export class DrizzleLedgerRepository implements LedgerRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: CreateLedgerInput): Promise<LedgerEntity> {
    return this.client.runTenantTx(input.tenantId, 'create ledger', async (tx) => {
      const [created] = await tx
        .insert(schema.ledgers)
        .values({ tenantId: input.tenantId, name: input.name })
        .returning();
      return toLedgerEntity(created);
    });
  }

  public async findById(tenantId: string, id: string): Promise<LedgerEntity | null> {
    return this.client.runTenantTx(
      tenantId,
      'find ledger by id for tenant',
      async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.ledgers)
          .where(and(eq(schema.ledgers.tenantId, tenantId), eq(schema.ledgers.id, id)))
          .limit(1);
        return row ? toLedgerEntity(row) : null;
      },
    );
  }

  public async list(tenantId: string): Promise<LedgerEntity[]> {
    return this.client.runTenantTx(tenantId, 'find ledgers by tenant', async (tx) => {
      const rows = await tx
        .select()
        .from(schema.ledgers)
        .where(eq(schema.ledgers.tenantId, tenantId))
        .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));
      return rows.map(toLedgerEntity);
    });
  }
}
