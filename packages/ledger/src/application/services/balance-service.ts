import { assertNonEmpty } from '../../utils';
import { InvariantViolationError } from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type { BalanceApplicationRepository } from '../repositories.interface';
import type {
  BalanceAtQuery,
  BalanceHistoryQuery,
  BalanceSnapshotEvent,
  HistoricalBalance,
  LedgerTrialBalanceQuery,
  PaginatedResult,
  TrialBalance,
} from '../types';

export class BalanceService {
  public constructor(private readonly repository: BalanceApplicationRepository) {}

  public async getTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.ledgerId, 'ledgerId is required');
    return this.repository.getTrialBalance(query);
  }

  public async getAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.accountId, 'accountId is required');
    if (!(query.at instanceof Date) || Number.isNaN(query.at.getTime())) {
      throw new InvariantViolationError('at must be a valid ISO-8601 timestamp');
    }
    return this.repository.getAt(query);
  }

  public async listHistory(
    query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.accountId, 'accountId is required');
    if (!(query.from instanceof Date) || Number.isNaN(query.from.getTime())) {
      throw new InvariantViolationError('from must be a valid ISO-8601 timestamp');
    }
    if (!(query.to instanceof Date) || Number.isNaN(query.to.getTime())) {
      throw new InvariantViolationError('to must be a valid ISO-8601 timestamp');
    }
    if (query.from.getTime() > query.to.getTime()) {
      throw new InvariantViolationError('from must be less than or equal to to');
    }
    validatePaginationQuery({ tenantId: query.tenantId, limit: query.limit, cursor: query.cursor });
    return this.repository.listHistory(query);
  }
}
