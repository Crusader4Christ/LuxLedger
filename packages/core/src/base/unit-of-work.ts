import type { TenantId } from './id';

export interface UnitOfWorkContext {
  readonly tenantId: TenantId;
}

export interface UnitOfWork {
  run<T>(work: (context: UnitOfWorkContext) => Promise<T>): Promise<T>;
}
