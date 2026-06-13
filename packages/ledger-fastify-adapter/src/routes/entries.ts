import type { EntryEntity } from '@lux/ledger';
import type { TransactionService } from '@lux/ledger/application';
import {
  type EntryResponse,
  entriesPageResponseSchema,
  type ListEntriesQuery,
} from '@lux/ledger-http/contracts';
import { toEntryResponse } from '@lux/ledger-http/mappers';
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
