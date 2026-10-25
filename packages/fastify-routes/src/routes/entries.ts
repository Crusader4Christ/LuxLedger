import type { EntryEntity } from '@luxledger/core';
import type { entryListFilter, TransactionService, WhereFor } from '@luxledger/core/application';
import {
  entryFilterFields,
  invalidWhereError,
  readWhereParameter,
  whereQueryProperty,
} from '@luxledger/http';
import {
  type EntryResponse,
  entriesPageResponseSchema,
  type ListEntriesQuery,
} from '@luxledger/http/contracts';
import { toEntryResponse } from '@luxledger/http/mappers';
import { BasePaginatedRoute, type PaginatedRequest } from '../routing/paginated-route';

export class EntriesListRoute extends BasePaginatedRoute<
  EntryEntity,
  EntryResponse,
  ListEntriesQuery
> {
  protected readonly path = '/v1/entries';

  protected querystringSchema() {
    return super.querystringSchema({
      properties: { where: whereQueryProperty(entryFilterFields) },
    });
  }

  public constructor(private readonly transactions: TransactionService) {
    super();
  }

  protected list(request: PaginatedRequest<ListEntriesQuery>) {
    const where = readWhereParameter<WhereFor<typeof entryListFilter>>(
      request.raw.url ?? '',
      entryFilterFields,
    );
    if (where === null) throw invalidWhereError();
    return this.transactions.listEntries({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
      where,
    });
  }

  protected toDto(entry: EntryEntity): EntryResponse {
    return toEntryResponse(entry);
  }

  protected override responseSchema() {
    return entriesPageResponseSchema;
  }
}
