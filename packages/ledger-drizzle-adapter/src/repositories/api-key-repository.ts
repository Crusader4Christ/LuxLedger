import type { ApiKeyEntity, ApiKeyRole } from '@lux/ledger';
import type { ApiKeyRepository } from '@lux/ledger/application';
import { and, asc, eq, sql } from 'drizzle-orm';
import { toApiKeyEntity } from '../mappers/api-key-mapper';
import type { DrizzleRepositoryContext } from '../repository-context';
import * as schema from '../schema';

export class DrizzleApiKeyRepository implements ApiKeyRepository {
  public constructor(private readonly context: DrizzleRepositoryContext) {}

  public async count(): Promise<number> {
    try {
      const [row] = await this.context.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.apiKeys)
        .limit(1);
      return row?.count ?? 0;
    } catch (error) {
      this.context.handleDatabaseError(error, 'count api keys');
    }
  }

  public async createTenant(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    try {
      const [created] = await this.context.db
        .insert(schema.tenants)
        .values({ name: input.name })
        .returning();
      return { id: created.id, name: created.name, createdAt: created.createdAt };
    } catch (error) {
      this.context.handleDatabaseError(error, 'create tenant');
    }
  }

  public async findActiveByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    try {
      const [row] = await this.context.db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.keyHash, keyHash), sql`${schema.apiKeys.revokedAt} is null`))
        .limit(1);
      return row ? toApiKeyEntity(row) : null;
    } catch (error) {
      this.context.handleDatabaseError(error, 'find api key by hash');
    }
  }

  public async findById(apiKeyId: string): Promise<ApiKeyEntity | null> {
    try {
      const [row] = await this.context.db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, apiKeyId))
        .limit(1);
      return row ? toApiKeyEntity(row) : null;
    } catch (error) {
      this.context.handleDatabaseError(error, 'find api key by id');
    }
  }

  public async create(input: {
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
  }): Promise<ApiKeyEntity> {
    try {
      return await this.context.withTenantTransaction(input.tenantId, async (tx) => {
        const [created] = await tx.insert(schema.apiKeys).values(input).returning();
        return toApiKeyEntity(created);
      });
    } catch (error) {
      this.context.handleDatabaseError(error, 'create api key');
    }
  }

  public async list(tenantId: string): Promise<ApiKeyEntity[]> {
    try {
      return await this.context.withTenantTransaction(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.tenantId, tenantId))
          .orderBy(asc(schema.apiKeys.createdAt), asc(schema.apiKeys.id));
        return rows.map(toApiKeyEntity);
      });
    } catch (error) {
      this.context.handleDatabaseError(error, 'list api keys');
    }
  }

  public async revoke(tenantId: string, apiKeyId: string): Promise<boolean> {
    try {
      return await this.context.withTenantTransaction(tenantId, async (tx) => {
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
    } catch (error) {
      this.context.handleDatabaseError(error, 'revoke api key');
    }
  }
}
