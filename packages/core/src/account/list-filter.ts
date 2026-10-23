import { defineListFilter } from '../application/list-filters';
import type { AccountEntity } from './entity';

export const accountListFilter = defineListFilter<AccountEntity>()(['tenantId']);
