import { type DrizzleDatabase, executeDatabaseOperation } from '../database-operation';
import * as schema from '../schema';

export class DrizzleTenantRepository {
  public constructor(private readonly db: DrizzleDatabase) {}

  public async create(input: {
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
}
