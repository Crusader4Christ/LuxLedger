import type { TenantEntity } from './entity';
import type { CreateTenantInput } from './input.interface';

export interface TenantRepository {
  create(input: CreateTenantInput): Promise<TenantEntity>;
}
