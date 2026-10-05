import type { TenantId } from './id';

export interface UnitOfWorkContext {
  readonly tenantId: TenantId;
}

export interface UnitOfWork<Context extends UnitOfWorkContext = UnitOfWorkContext> {
  run<T>(tenantId: TenantId, work: (context: Context) => Promise<T>): Promise<T>;
}
