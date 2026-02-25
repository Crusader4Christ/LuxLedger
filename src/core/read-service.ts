import { InvariantViolationError } from '@core/errors';
import type {
  AccountListItem,
  EntryListItem,
  LedgerReadRepository,
  PaginatedResult,
  PaginationQuery,
  TransactionListItem,
} from '@core/types';

export class LedgerReadService {
  private readonly repository: LedgerReadRepository;

  public constructor(repository: LedgerReadRepository) {
    this.repository = repository;
  }

  public async listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountListItem>> {
    this.validateQuery(query);
    return this.repository.listAccounts(query);
  }

  public async listTransactions(
    query: PaginationQuery,
  ): Promise<PaginatedResult<TransactionListItem>> {
    this.validateQuery(query);
    return this.repository.listTransactions(query);
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryListItem>> {
    this.validateQuery(query);
    return this.repository.listEntries(query);
  }

  private validateQuery(query: PaginationQuery): void {
    if (query.tenantId.trim().length === 0) {
      throw new InvariantViolationError('tenantId is required');
    }

    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) {
      throw new InvariantViolationError('limit must be an integer between 1 and 200');
    }

    if (query.cursor !== undefined && query.cursor.trim().length === 0) {
      throw new InvariantViolationError('cursor must be a non-empty string');
    }
  }
}
