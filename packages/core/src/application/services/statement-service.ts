import { assertNonEmpty } from '../../utils';
import { InvariantViolationError } from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type { StatementRepository } from '../repositories.interface';
import type {
  AccountStatement,
  AccountStatementQuery,
  CreditLotStatement,
  CreditLotStatementQuery,
} from '../types';

export class StatementService {
  public constructor(private readonly repository: StatementRepository) {}

  public getAccountStatement(query: AccountStatementQuery): Promise<AccountStatement> {
    this.validate(query);
    return this.repository.getAccountStatement(query);
  }

  public getCreditLotStatement(query: CreditLotStatementQuery): Promise<CreditLotStatement> {
    this.validate(query);
    if (query.grantId !== undefined) assertNonEmpty(query.grantId, 'grantId must not be empty');
    return this.repository.getCreditLotStatement(query);
  }

  private validate(query: AccountStatementQuery): void {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.accountId, 'accountId is required');
    if (!(query.from instanceof Date) || Number.isNaN(query.from.getTime())) {
      throw new InvariantViolationError('from must be a valid ISO-8601 timestamp');
    }
    if (!(query.asOf instanceof Date) || Number.isNaN(query.asOf.getTime())) {
      throw new InvariantViolationError('asOf must be a valid ISO-8601 timestamp');
    }
    if (query.from.getTime() > query.asOf.getTime()) {
      throw new InvariantViolationError('from must be less than or equal to asOf');
    }
    validatePaginationQuery(query);
  }
}
