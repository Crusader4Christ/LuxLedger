import {
  type EntryResponse,
  entriesPageResponseSchema,
  type ListEntriesQuery,
} from '@api/contracts/entries';
import { BasePaginatedRoute, type PaginatedRequest } from '@api/routes/pagination';
import { type EntryEntity, InvariantViolationError, type LedgerService } from '@lux/ledger';

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
    if (!entry.id || !entry.transactionId || !entry.createdAt) {
      throw new InvariantViolationError('entry must be persisted before listing');
    }

    return {
      id: entry.id,
      transaction_id: entry.transactionId,
      account_id: entry.accountId.value,
      direction: entry.direction,
      amount_minor: entry.money.amountMinor.toString(),
      currency: entry.money.currency,
      created_at: entry.createdAt.toISOString(),
    };
  }

  protected override responseSchema() {
    return entriesPageResponseSchema;
  }
}
