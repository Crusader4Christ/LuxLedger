import { type AccountEntity, AccountSide, OverdraftPolicy } from '../../account/entity';
import { assertNonEmpty } from '../../utils';
import { AccountNotFoundError, InvariantViolationError } from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type { AccountRepository } from '../repositories.interface';
import type { AccountPaginationQuery, CreateAccountInput, PaginatedResult } from '../types';

export class AccountService {
  public constructor(private readonly repository: AccountRepository) {}

  public async create(input: CreateAccountInput): Promise<AccountEntity> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.name, 'name is required');
    assertNonEmpty(input.currency, 'currency is required');
    if (!(Object.values(AccountSide) as string[]).includes(input.side)) {
      throw new InvariantViolationError('account side must be DEBIT or CREDIT');
    }
    if (
      input.overdraftPolicy !== undefined &&
      !(Object.values(OverdraftPolicy) as string[]).includes(input.overdraftPolicy)
    ) {
      throw new InvariantViolationError('overdraft policy must be ALLOW or DISALLOW');
    }
    return this.repository.create(input);
  }

  public async getById(tenantId: string, accountId: string): Promise<AccountEntity> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(accountId, 'account id is required');
    const account = await this.repository.findById(tenantId, accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }
    return account;
  }

  public async list(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>> {
    validatePaginationQuery(query);
    if (query.ledgerId !== undefined) {
      assertNonEmpty(query.ledgerId, 'ledgerId must be a non-empty string');
    }
    return this.repository.list(query);
  }
}
