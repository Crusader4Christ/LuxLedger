import type { EntryEntity } from '@luxledger/core';
import type { TransactionService } from '@luxledger/core/application';
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

  public constructor(private readonly transactions: TransactionService) {
    super();
  }

  protected list(request: PaginatedRequest<ListEntriesQuery>) {
    return this.transactions.listEntries({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
    });
  }

  protected toDto(entry: EntryEntity): EntryResponse {
    return toEntryResponse(entry);
  }

  protected override responseSchema() {
    return entriesPageResponseSchema;
  }
}
