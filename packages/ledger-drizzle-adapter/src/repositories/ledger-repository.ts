import type { LedgerEntity } from '@lux/ledger';
import type { CreateLedgerInput, LedgerRepository } from '@lux/ledger/application';
import { and, asc, eq } from 'drizzle-orm';
import { toLedgerEntity } from '../mappers/ledger-mapper';
import type { DrizzleRepositoryContext } from '../repository-context';
import * as schema from '../schema';

export class DrizzleLedgerRepository implements LedgerRepository {
  public constructor(private readonly context: DrizzleRepositoryContext) {}

  public async create(input: CreateLedgerInput): Promise<LedgerEntity> {
    try {
      return await this.context.withTenantTransaction(input.tenantId, async (tx) => {
        const [created] = await tx
          .insert(schema.ledgers)
          .values({ tenantId: input.tenantId, name: input.name })
          .returning();
        return toLedgerEntity(created);
      });
    } catch (error) {
      this.context.handleDatabaseError(error, 'create ledger');
    }
  }

  public async findById(tenantId: string, id: string): Promise<LedgerEntity | null> {
    try {
      return await this.context.withTenantTransaction(tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.ledgers)
          .where(and(eq(schema.ledgers.tenantId, tenantId), eq(schema.ledgers.id, id)))
          .limit(1);
        return row ? toLedgerEntity(row) : null;
      });
    } catch (error) {
      this.context.handleDatabaseError(error, 'find ledger by id for tenant');
    }
  }

  public async list(tenantId: string): Promise<LedgerEntity[]> {
    try {
      return await this.context.withTenantTransaction(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.ledgers)
          .where(eq(schema.ledgers.tenantId, tenantId))
          .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));
        return rows.map(toLedgerEntity);
      });
    } catch (error) {
      this.context.handleDatabaseError(error, 'find ledgers by tenant');
    }
  }
}
