import type { Asset, AssetRepository, CreateAssetInput } from '@luxledger/core/application';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client';
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

  public async list(tenantId: string): Promise<Asset[]> {
    return this.client.runTenantTx(tenantId, 'list assets', (tx) =>
      tx
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.tenantId, tenantId))
        .orderBy(schema.assets.code),
    );
  }
}
