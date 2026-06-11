import type { DrizzleRepositoryContext } from '../repository-context';
import * as schema from '../schema';

export class DrizzleTenantRepository {
  public constructor(private readonly context: DrizzleRepositoryContext) {}

  public async create(input: {
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
}
