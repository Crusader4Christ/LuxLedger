import { defineListFilter, type PersistedFilterModel } from '../application/list-filters';
import type { EntryEntity } from './entity';

// Project Money to the scalar fields accepted by entry list queries.
export const entryListFilter = defineListFilter<
  PersistedFilterModel<EntryEntity, 'id' | 'transactionId' | 'createdAt'> & {
    signedAmountMinor: EntryEntity['money']['amountMinor'];
    currency: EntryEntity['money']['currency'];
  }
>()(['money']);
