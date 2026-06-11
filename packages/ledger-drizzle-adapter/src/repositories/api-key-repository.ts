import type { ApiKeyEntity, ApiKeyRole } from '@lux/ledger';
import type { ApiKeyRepository } from '@lux/ledger/application';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  type DrizzleDatabase,
  executeDatabaseOperation,
  withTenantTransaction,
} from '../database-operation';
import { toApiKeyEntity } from '../mappers/api-key-mapper';
import * as schema from '../schema';

export class DrizzleApiKeyRepository implements ApiKeyRepository {
  public constructor(private readonly db: DrizzleDatabase) {}

  public async count(): Promise<number> {
    return executeDatabaseOperation('count api keys', async () => {
      const [row] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.apiKeys)
        .limit(1);
      return row?.count ?? 0;
    });
  }

  public async createTenant(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    return executeDatabaseOperation('create tenant', async () => {
      const [created] = await this.db
        .insert(schema.tenants)
        .values({ name: input.name })
        .returning();
      return {
        id: created.id,
        name: created.name,
        createdAt: created.createdAt,
      };
    });
  }

  public async findActiveByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    return executeDatabaseOperation('find api key by hash', async () => {
      const [row] = await this.db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.keyHash, keyHash), sql`${schema.apiKeys.revokedAt} is null`))
        .limit(1);
      return row ? toApiKeyEntity(row) : null;
    });
  }

  public async findById(apiKeyId: string): Promise<ApiKeyEntity | null> {
    return executeDatabaseOperation('find api key by id', async () => {
      const [row] = await this.db
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
    return withTenantTransaction(this.db, input.tenantId, 'create api key', async (tx) => {
      const [created] = await tx.insert(schema.apiKeys).values(input).returning();
      return toApiKeyEntity(created);
    });
  }

  public async list(tenantId: string): Promise<ApiKeyEntity[]> {
    return withTenantTransaction(this.db, tenantId, 'list api keys', async (tx) => {
      const rows = await tx
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.tenantId, tenantId))
        .orderBy(asc(schema.apiKeys.createdAt), asc(schema.apiKeys.id));
      return rows.map(toApiKeyEntity);
    });
  }

  public async revoke(tenantId: string, apiKeyId: string): Promise<boolean> {
    return withTenantTransaction(this.db, tenantId, 'revoke api key', async (tx) => {
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
