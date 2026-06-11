import type { DbClient } from '../client';
import * as schema from '../schema';

export class DrizzleTenantRepository {
  public constructor(private readonly client: DbClient) {}

  public async create(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    return this.client.execute('create tenant', async () => {
      const [created] = await this.client.db
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
}
