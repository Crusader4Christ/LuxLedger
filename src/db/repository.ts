import { InvariantViolationError, RepositoryError } from '@core/errors';
import type { CreateLedgerInput, Ledger, LedgerRepository } from '@core/types';
import { toLedger } from '@db/mappers';
import * as schema from '@db/schema';
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const CONSTRAINT_VIOLATION_CODES = new Set([
  '22001', // string_data_right_truncation
  '22007', // invalid_datetime_format
  '22P02', // invalid_text_representation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
]);

interface DatabaseErrorLike {
  code?: unknown;
  cause?: unknown;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractDatabaseCode = (error: unknown): string | null => {
  if (!isObjectRecord(error)) {
    return null;
  }

  const dbError = error as DatabaseErrorLike;

  if (typeof dbError.code === 'string') {
    return dbError.code;
  }

  if ('cause' in error) {
    return extractDatabaseCode(dbError.cause);
  }

  return null;
};

export class DrizzleLedgerRepository implements LedgerRepository {
  private readonly db: PostgresJsDatabase<typeof schema>;

  public constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    try {
      const [created] = await this.db
        .insert(schema.ledgers)
        .values({
          tenantId: input.tenantId,
          name: input.name,
        })
        .returning();

      return toLedger(created);
    } catch (error) {
      this.handleDatabaseError(error, 'create ledger');
    }
  }

  public async findLedgerById(id: string): Promise<Ledger | null> {
    try {
      const [ledger] = await this.db
        .select()
        .from(schema.ledgers)
        .where(eq(schema.ledgers.id, id))
        .limit(1);

      if (!ledger) {
        return null;
      }

      return toLedger(ledger);
    } catch (error) {
      this.handleDatabaseError(error, 'find ledger by id');
    }
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    try {
      const rows = await this.db
        .select()
        .from(schema.ledgers)
        .where(eq(schema.ledgers.tenantId, tenantId))
        .orderBy(asc(schema.ledgers.createdAt), asc(schema.ledgers.id));

      return rows.map((row) => toLedger(row));
    } catch (error) {
      this.handleDatabaseError(error, 'find ledgers by tenant');
    }
  }

  private handleDatabaseError(error: unknown, operation: string): never {
    const databaseCode = extractDatabaseCode(error);

    if (databaseCode && CONSTRAINT_VIOLATION_CODES.has(databaseCode)) {
      throw new InvariantViolationError(`Unable to ${operation}: data constraints violated`, {
        cause: error,
      });
    }

    throw new RepositoryError(`Unable to ${operation}`, { cause: error });
  }
}
