import { AsyncLocalStorage } from 'node:async_hooks';
import { isDomainError } from '@luxledger/core';
import type {
  ApplicationUnitOfWork,
  ApplicationUnitOfWorkContext,
  TransactionQuery,
} from '@luxledger/core/application';
import { InvariantViolationError, RepositoryError } from '@luxledger/core/application';
import type { TenantId } from '@luxledger/core/base';
import { sql } from 'drizzle-orm';
import { createApplicationServices } from './application-services';
import type { DbClient, DrizzleDatabase } from './client';

const NESTED_UNIT_OF_WORK_MESSAGE = 'Nested unit of work is not supported';
const TENANT_MISMATCH_MESSAGE = 'Unit of work tenant does not match operation tenant';
const UNSCOPED_OPERATION_MESSAGE = 'Unscoped operation is not allowed in a tenant unit of work';

class UnitOfWorkCallbackFailure extends Error {
  public constructor(public readonly original: unknown) {
    super('Unit of work callback failed');
  }
}

const createTransactionQuery =
  (client: DbClient, transaction: DrizzleDatabase): TransactionQuery =>
  async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly Row[]> => {
    const chunks = strings.flatMap((part, index) =>
      index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)],
    );
    return client.execute(
      'execute host unit of work query',
      async () => (await transaction.execute(sql.join(chunks))) as unknown as readonly Row[],
    );
  };

const createTransactionClient = (
  client: DbClient,
  transaction: DrizzleDatabase,
  tenantId: string,
): DbClient => ({
  sql: client.sql,
  execute: (operation, action) => client.execute(operation, () => action(transaction)),
  runTx: async () => {
    throw new InvariantViolationError(UNSCOPED_OPERATION_MESSAGE);
  },
  runTenantTx: async (operationTenantId, _operation, action) => {
    if (operationTenantId !== tenantId) {
      throw new InvariantViolationError(TENANT_MISMATCH_MESSAGE);
    }
    return client.execute(_operation, () => action(transaction));
  },
});

export class PostgresUnitOfWork implements ApplicationUnitOfWork {
  private readonly active = new AsyncLocalStorage<boolean>();

  public constructor(private readonly client: DbClient) {}

  public run<T>(
    tenantId: TenantId,
    work: (context: ApplicationUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    if (this.active.getStore()) {
      throw new InvariantViolationError(NESTED_UNIT_OF_WORK_MESSAGE);
    }

    return this.active
      .run(true, () =>
        this.client.runTenantTx(tenantId.value, 'run tenant unit of work', async (transaction) => {
          const transactionClient = createTransactionClient(
            this.client,
            transaction,
            tenantId.value,
          );
          try {
            return await work({
              tenantId,
              services: createApplicationServices(transactionClient),
              query: createTransactionQuery(this.client, transaction),
            });
          } catch (error) {
            if (isDomainError(error)) throw error;
            throw new UnitOfWorkCallbackFailure(error);
          }
        }),
      )
      .catch((error: unknown) => {
        if (error instanceof RepositoryError && error.cause instanceof UnitOfWorkCallbackFailure) {
          throw error.cause.original;
        }
        throw error;
      });
  }
}

export const createUnitOfWork = (client: DbClient): ApplicationUnitOfWork =>
  new PostgresUnitOfWork(client);
