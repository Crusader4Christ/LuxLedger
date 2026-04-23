import { BasePaginatedListRoute, type PaginatedRequest } from '@api/routes/pagination';
import type { EntryListItemDto } from '@api/routes/types/list-item-dto';
import { InvariantViolationError, type EntryEntity, type LedgerService } from '@lux/ledger';

export class EntriesListRoute extends BasePaginatedListRoute<EntryEntity, EntryListItemDto> {
  protected readonly path = '/v1/entries';

  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  protected list(request: PaginatedRequest) {
    return this.ledgerService.listEntries({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
    });
  }

  protected mapItem(entry: EntryEntity) {
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
}
