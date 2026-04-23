import { BasePaginatedListRoute, type PaginatedRequest } from '@api/routes/pagination';
import type { TransactionListItemDto } from '@api/routes/types/list-item-dto';
import { InvariantViolationError, type LedgerService, type TransactionEntity } from '@lux/ledger';

export class TransactionsListRoute extends BasePaginatedListRoute<
  TransactionEntity,
  TransactionListItemDto
> {
  protected readonly path = '/v1/transactions';

  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  protected list(request: PaginatedRequest) {
    return this.ledgerService.listTransactions({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
    });
  }

  protected mapItem(transaction: TransactionEntity) {
    if (!transaction.tenantId || !transaction.reference || !transaction.createdAt) {
      throw new InvariantViolationError('transaction must be persisted before listing');
    }

    return {
      id: transaction.id.value,
      tenant_id: transaction.tenantId,
      ledger_id: transaction.ledgerId.value,
      reference: transaction.reference,
      currency: transaction.currency,
      created_at: transaction.createdAt.toISOString(),
    };
  }
}
