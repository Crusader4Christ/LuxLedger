import type { TenantEntity } from './entity';
import type { CreateTenantInput } from './input.interface';

export interface TenantRepository {
  createTenant(input: CreateTenantInput): Promise<TenantEntity>;
}
