import type {
  Asset,
  AssetRepository,
  CreateAssetInput,
  PaginatedResult,
  PaginationQuery,
} from '@luxledger/core/application';
import { assetListFilter } from '@luxledger/core/application';
import { and, eq, getTableColumns } from 'drizzle-orm';
import type { DbClient } from '../client';
import { listWhereScope, listWhereSql } from '../list-where';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';

export class DrizzleAssetRepository implements AssetRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: CreateAssetInput): Promise<Asset> {
    return this.client.runTenantTx(input.tenantId, 'create asset', async (tx) => {
      const [asset] = await tx.insert(schema.assets).values(input).returning();
      return asset;
    });
  }

  public async findById(tenantId: string, assetId: string): Promise<Asset | null> {
    return this.client.runTenantTx(tenantId, 'find asset', async (tx) => {
      const [asset] = await tx
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.tenantId, tenantId), eq(schema.assets.id, assetId)))
        .limit(1);
      return asset ?? null;
    });
  }

  public async list(
    query: PaginationQuery<typeof assetListFilter>,
  ): Promise<PaginatedResult<Asset>> {
    return this.client.runTenantTx(query.tenantId, 'list assets', async (tx) => {
      const predicates = [
        eq(schema.assets.tenantId, query.tenantId),
        listWhereSql(getTableColumns(schema.assets), assetListFilter, query.where),
      ];
      const page = await paginateByCursor<typeof schema.assets.$inferSelect>({
        query,
        scope: { resource: 'assets', tenantId: query.tenantId, ...listWhereScope(query.where) },
        order: [
          { column: schema.assets.code, key: 'code', type: 'string', getValue: (row) => row.code },
          { column: schema.assets.id, key: 'id', type: 'uuid', getValue: (row) => row.id },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select()
            .from(schema.assets)
            .where(and(...predicates, cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });
      return { data: page.rows, nextCursor: page.nextCursor };
    });
  }
}
