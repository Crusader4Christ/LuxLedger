import { defineListFilter, type PersistedFilterModel } from '../application/list-filters';
import type { TransactionEntity } from './entity';

export const transactionListFilter = defineListFilter<
  PersistedFilterModel<TransactionEntity, 'createdAt' | 'effectiveAt'>
>()({ exclude: ['tenantId', 'metadata', 'entries'] });
