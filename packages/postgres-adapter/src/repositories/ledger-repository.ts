import type { LedgerEntity } from '@luxledger/core';
import type { CreateLedgerInput, LedgerRepository, WhereFor } from '@luxledger/core/application';
import { ledgerListFilter } from '@luxledger/core/application';
import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import type { DbClient } from '../client';
import { listWhereSql } from '../list-where';
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
    return this.client.runTenantTx(tenantId, 'find ledger by id for tenant', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.ledgers)
        .where(and(eq(schema.ledgers.tenantId, tenantId), eq(schema.ledgers.id, id)))
        .limit(1);
      return row ? toLedgerEntity(row) : null;
    });
  }

  public async list(
    tenantId: string,
    where?: WhereFor<typeof ledgerListFilter>,
  ): Promise<LedgerEntity[]> {
    return this.client.runTenantTx(tenantId, 'find ledgers by tenant', async (tx) => {
      const rows = await tx
        .select()
        .from(schema.ledgers)
        .where(
          and(
            eq(schema.ledgers.tenantId, tenantId),
            listWhereSql(getTableColumns(schema.ledgers), ledgerListFilter, where),
          ),
        )
        .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));
      return rows.map(toLedgerEntity);
    });
  }
}
