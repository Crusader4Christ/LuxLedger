import { BasePaginatedListRoute, type PaginatedRequest } from '@api/routes/pagination';
import type { AccountListItemDto } from '@api/routes/types/list-item-dto';
import type { AccountEntity } from '@lux/ledger';
import type { LedgerService } from '@services/ledger-service';

export class AccountsListRoute extends BasePaginatedListRoute<AccountEntity, AccountListItemDto> {
  protected readonly path = '/v1/accounts';

  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  protected list(request: PaginatedRequest) {
    return this.ledgerService.listAccounts({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
    });
  }

  protected mapItem(account: AccountEntity) {
    return {
      id: account.id,
      tenant_id: account.tenantId,
      ledger_id: account.ledgerId,
      name: account.name,
      side: account.side,
      currency: account.currency,
      balance_minor: account.balanceMinor.toString(),
      created_at: account.createdAt.toISOString(),
    };
  }
}
