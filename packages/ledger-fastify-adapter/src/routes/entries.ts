import {
  type EntryResponse,
  entriesPageResponseSchema,
  type ListEntriesQuery,
} from '@lux/ledger-http/contracts';
import { toEntryResponse } from '@lux/ledger-http/mappers';
import { BasePaginatedRoute, type PaginatedRequest } from '../routes/pagination';
import { type EntryEntity, type LedgerService } from '@lux/ledger';

export class EntriesListRoute extends BasePaginatedRoute<
  EntryEntity,
  EntryResponse,
  ListEntriesQuery
> {
  protected readonly path = '/v1/entries';

  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  protected list(request: PaginatedRequest<ListEntriesQuery>) {
    return this.ledgerService.listEntries({
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
