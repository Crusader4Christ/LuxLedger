import type { AccountEntity } from '@lux/ledger';
import {
  type AccountPaginationQuery,
  type AccountRepository,
  type CreateAccountInput,
  LedgerNotFoundError,
  type PaginatedResult,
} from '@lux/ledger/application';
import { and, eq } from 'drizzle-orm';
import { type DrizzleDatabase, withTenantTransaction } from '../database-operation';
import { toAccountEntity } from '../mappers/account-mapper';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';

export class DrizzleAccountRepository implements AccountRepository {
  public constructor(private readonly db: DrizzleDatabase) {}

  public async create(input: CreateAccountInput): Promise<AccountEntity> {
    return withTenantTransaction(this.db, input.tenantId, 'create account', async (tx) => {
      const [ledger] = await tx
        .select({ id: schema.ledgers.id })
        .from(schema.ledgers)
        .where(
          and(eq(schema.ledgers.id, input.ledgerId), eq(schema.ledgers.tenantId, input.tenantId)),
        )
        .limit(1);
      if (!ledger) {
        throw new LedgerNotFoundError(input.ledgerId);
      }

      const [created] = await tx
        .insert(schema.accounts)
        .values({
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          name: input.name,
          side: input.side,
          overdraftPolicy: input.overdraftPolicy ?? 'ALLOW',
          currency: input.currency,
        })
        .returning();
      return toAccountEntity(created);
    });
  }

  public async findById(tenantId: string, accountId: string): Promise<AccountEntity | null> {
    return withTenantTransaction(this.db, tenantId, 'find account by id for tenant', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.accounts)
        .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, accountId)))
        .limit(1);
      return row ? toAccountEntity(row) : null;
    });
  }

  public async list(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>> {
    return withTenantTransaction(this.db, query.tenantId, 'list accounts', async (tx) => {
      const predicates = [eq(schema.accounts.tenantId, query.tenantId)];
      if (query.ledgerId !== undefined) {
        predicates.push(eq(schema.accounts.ledgerId, query.ledgerId));
      }

      const page = await paginateByCursor<typeof schema.accounts.$inferSelect>({
        query,
        order: [
          {
            column: schema.accounts.createdAt,
            key: 'created_at',
            type: 'date',
            direction: 'asc',
            getValue: (row) => row.createdAt,
          },
          {
            column: schema.accounts.id,
            key: 'id',
            type: 'string',
            direction: 'asc',
            getValue: (row) => row.id,
          },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select()
            .from(schema.accounts)
            .where(and(...predicates, cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });

      return {
        data: page.rows.map(toAccountEntity),
        nextCursor: page.nextCursor,
      };
    });
  }
}
