import { AsyncLocalStorage } from 'node:async_hooks';
import { isDomainError } from '@luxledger/core';
import type { ApplicationUnitOfWorkContext } from '@luxledger/core/application';
import { InvariantViolationError, RepositoryError } from '@luxledger/core/application';
import type { TenantId, UnitOfWork } from '@luxledger/core/base';
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

const createTransactionClient = <THostSchema extends Record<string, unknown>>(
  client: DbClient<THostSchema>,
  transaction: DrizzleDatabase<THostSchema>,
  tenantId: string,
): DbClient => {
  // The combined transaction always contains the complete LuxLedger schema.
  // Repositories receive only the narrower package-owned schema view.
  const ledgerTransaction = transaction as unknown as DrizzleDatabase;
  return {
    sql: client.sql,
    execute: (operation, action) => client.execute(operation, () => action(ledgerTransaction)),
    runTx: async () => {
      throw new InvariantViolationError(UNSCOPED_OPERATION_MESSAGE);
    },
    runTenantTx: async (operationTenantId, _operation, action) => {
      if (operationTenantId !== tenantId) {
        throw new InvariantViolationError(TENANT_MISMATCH_MESSAGE);
      }
      return client.execute(_operation, () => action(ledgerTransaction));
    },
  };
};

export interface UnitOfWorkContext<
  THostSchema extends Record<string, unknown> = Record<never, never>,
> extends ApplicationUnitOfWorkContext {
  readonly tx: DrizzleDatabase<THostSchema>;
}

export type AdapterUnitOfWork<THostSchema extends Record<string, unknown> = Record<never, never>> =
  UnitOfWork<UnitOfWorkContext<THostSchema>>;

export class PostgresUnitOfWork<THostSchema extends Record<string, unknown> = Record<never, never>>
  implements AdapterUnitOfWork<THostSchema>
{
  private readonly active = new AsyncLocalStorage<boolean>();

  public constructor(private readonly client: DbClient<THostSchema>) {}

  public run<T>(
    tenantId: TenantId,
    work: (context: UnitOfWorkContext<THostSchema>) => Promise<T>,
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
              tx: transaction,
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

export const createUnitOfWork = <THostSchema extends Record<string, unknown>>(
  client: DbClient<THostSchema>,
): AdapterUnitOfWork<THostSchema> => new PostgresUnitOfWork(client);
