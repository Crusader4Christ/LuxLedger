import { type ApiKeyEntity, ApiKeyRole } from '@luxledger/core';
import type {
  ApiKeyRepository,
  BootstrapAdminRepositoryInput,
  BootstrapAdminResult,
  PaginatedResult,
  PaginationQuery,
} from '@luxledger/core/application';
import { apiKeyListFilter } from '@luxledger/core/application';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { DbClient } from '../client';
import { exactTimestamp } from '../exact-timestamp';
import { listWhereScope, listWhereSql } from '../list-where';
import { toApiKeyEntity } from '../mappers/api-key-mapper';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';

export class DrizzleApiKeyRepository implements ApiKeyRepository {
  public constructor(private readonly client: DbClient) {}

  public async bootstrapInitialAdmin(
    input: BootstrapAdminRepositoryInput,
  ): Promise<BootstrapAdminResult> {
    return this.client.runTx('bootstrap initial admin', async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('luxledger.bootstrap_admin'))`);

      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.apiKeys)
        .limit(1);
      if ((row?.count ?? 0) > 0) {
        return { created: false };
      }

      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ name: input.tenantName })
        .returning();

      const [apiKey] = await tx
        .insert(schema.apiKeys)
        .values({
          tenantId: tenant.id,
          name: input.keyName,
          role: ApiKeyRole.ADMIN,
          keyHash: input.keyHash,
        })
        .returning({ id: schema.apiKeys.id });

      return {
        created: true,
        tenantId: tenant.id,
        apiKeyId: apiKey.id,
      };
    });
  }

  public async findActiveByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    return this.client.execute('find api key by hash', async (db) => {
      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.keyHash, keyHash), sql`${schema.apiKeys.revokedAt} is null`))
        .limit(1);
      return row ? toApiKeyEntity(row) : null;
    });
  }

  public async findById(apiKeyId: string): Promise<ApiKeyEntity | null> {
    return this.client.execute('find api key by id', async (db) => {
      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, apiKeyId))
        .limit(1);
      return row ? toApiKeyEntity(row) : null;
    });
  }

  public async create(input: {
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
  }): Promise<ApiKeyEntity> {
    return this.client.runTenantTx(input.tenantId, 'create api key', async (tx) => {
      const [created] = await tx.insert(schema.apiKeys).values(input).returning();
      return toApiKeyEntity(created);
    });
  }

  public async list(
    query: PaginationQuery<typeof apiKeyListFilter>,
  ): Promise<PaginatedResult<ApiKeyEntity>> {
    return this.client.runTenantTx(query.tenantId, 'list api keys', async (tx) => {
      const predicates = [
        eq(schema.apiKeys.tenantId, query.tenantId),
        listWhereSql(getTableColumns(schema.apiKeys), apiKeyListFilter, query.where),
      ];
      const page = await paginateByCursor<
        typeof schema.apiKeys.$inferSelect & { cursorCreatedAt: string }
      >({
        query,
        scope: { resource: 'api-keys', tenantId: query.tenantId, ...listWhereScope(query.where) },
        order: [
          {
            column: schema.apiKeys.createdAt,
            key: 'created_at',
            type: 'timestamp',
            getValue: (row) => row.cursorCreatedAt,
          },
          { column: schema.apiKeys.id, key: 'id', type: 'uuid', getValue: (row) => row.id },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select({
              ...getTableColumns(schema.apiKeys),
              cursorCreatedAt: exactTimestamp(schema.apiKeys.createdAt),
            })
            .from(schema.apiKeys)
            .where(and(...predicates, cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });
      return { data: page.rows.map(toApiKeyEntity), nextCursor: page.nextCursor };
    });
  }

  public async revoke(tenantId: string, apiKeyId: string): Promise<boolean> {
    return this.client.runTenantTx(tenantId, 'revoke api key', async (tx) => {
      const [row] = await tx
        .update(schema.apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(schema.apiKeys.id, apiKeyId),
            eq(schema.apiKeys.tenantId, tenantId),
            sql`${schema.apiKeys.revokedAt} is null`,
          ),
        )
        .returning({ id: schema.apiKeys.id });
      return Boolean(row);
    });
  }
}
