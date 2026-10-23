import { defineListFilter } from '../application/list-filters';
import type { LedgerEntity } from './entity';

export const ledgerListFilter = defineListFilter<LedgerEntity>()(['tenantId', 'updatedAt']);
