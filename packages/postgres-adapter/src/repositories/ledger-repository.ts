import type { LedgerEntity } from '@luxledger/core';
import type {
  CreateLedgerInput,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
} from '@luxledger/core/application';
import { ledgerListFilter } from '@luxledger/core/application';
import { and, eq, getTableColumns } from 'drizzle-orm';
import type { DbClient } from '../client';
import { exactTimestamp } from '../exact-timestamp';
import { listWhereScope, listWhereSql } from '../list-where';
import { toLedgerEntity } from '../mappers/ledger-mapper';
import { paginateByCursor } from '../paginate-by-cursor';
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
    query: PaginationQuery<typeof ledgerListFilter>,
  ): Promise<PaginatedResult<LedgerEntity>> {
    return this.client.runTenantTx(query.tenantId, 'find ledgers by tenant', async (tx) => {
      const predicates = [
        eq(schema.ledgers.tenantId, query.tenantId),
        listWhereSql(getTableColumns(schema.ledgers), ledgerListFilter, query.where),
      ];
      const page = await paginateByCursor<
        typeof schema.ledgers.$inferSelect & { cursorCreatedAt: string }
      >({
        query,
        scope: { resource: 'ledgers', tenantId: query.tenantId, ...listWhereScope(query.where) },
        order: [
          {
            column: schema.ledgers.createdAt,
            key: 'created_at',
            type: 'timestamp',
            getValue: (row) => row.cursorCreatedAt,
          },
          { column: schema.ledgers.id, key: 'id', type: 'uuid', getValue: (row) => row.id },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select({
              ...getTableColumns(schema.ledgers),
              cursorCreatedAt: exactTimestamp(schema.ledgers.createdAt),
            })
            .from(schema.ledgers)
            .where(and(...predicates, cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });
      return { data: page.rows.map(toLedgerEntity), nextCursor: page.nextCursor };
    });
  }
}
