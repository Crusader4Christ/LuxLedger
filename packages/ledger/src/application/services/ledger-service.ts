import { type AccountEntity, AccountSide } from '../../account/entity';
import type { EntryEntity } from '../../entry/entity';
import type { TransactionEntity } from '../../transaction/entity';
import { assertNonEmpty } from '../../utils';
import {
  AccountNotFoundError,
  InvariantViolationError,
  LedgerNotFoundError,
  TransactionNotFoundError,
} from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type {
  AccountPaginationQuery,
  BalanceHistoryQuery,
  BalanceSnapshotEvent,
  CreateAccountInput,
  CreateLedgerInput,
  CreateHoldInput,
  CreateHoldResult,
  CreateTransactionInput,
  CreateTransactionResult,
  CommitHoldInput,
  CommitHoldResult,
  Ledger,
  LedgerRepository,
  HistoricalBalance,
  BalanceAtQuery,
  PaginatedResult,
  PaginationQuery,
  TransactionPaginationQuery,
  TrialBalance,
  LedgerTrialBalanceQuery,
  VoidHoldInput,
  VoidHoldResult,
} from '../types';

export class LedgerService {
  private readonly repository: LedgerRepository;

  public constructor(repository: LedgerRepository) {
    this.repository = repository;
  }

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.name, 'name is required');

    return this.repository.createLedger({
      tenantId: input.tenantId,
      name: input.name,
    });
  }

  public async getLedgerById(tenantId: string, id: string): Promise<Ledger> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(id, 'ledger id is required');

    const ledger = await this.repository.findLedgerByIdForTenant(tenantId, id);

    if (!ledger) {
      throw new LedgerNotFoundError(id);
    }

    return ledger;
  }

  public async getLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    assertNonEmpty(tenantId, 'tenantId is required');

    return this.repository.findLedgersByTenant(tenantId);
  }

  public async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.reference, 'reference is required');
    assertNonEmpty(input.currency, 'currency is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }

    return this.repository.createTransaction(input);
  }

  public async createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.reference, 'reference is required');
    assertNonEmpty(input.currency, 'currency is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }

    return this.repository.createHold(input);
  }

  public async commitHold(input: CommitHoldInput): Promise<CommitHoldResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.holdId, 'holdId is required');
    assertNonEmpty(input.reference, 'reference is required');
    if (input.amountMinor !== undefined && input.amountMinor <= 0n) {
      throw new InvariantViolationError('amountMinor must be positive when provided');
    }

    return this.repository.commitHold(input);
  }

  public async voidHold(input: VoidHoldInput): Promise<VoidHoldResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.holdId, 'holdId is required');

    return this.repository.voidHold(input);
  }

  public async createAccount(input: CreateAccountInput): Promise<AccountEntity> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.name, 'name is required');
    assertNonEmpty(input.currency, 'currency is required');
    this.assertAccountSide(input.side);

    return this.repository.createAccount(input);
  }

  public async getAccountById(tenantId: string, accountId: string): Promise<AccountEntity> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(accountId, 'account id is required');

    const account = await this.repository.findAccountByIdForTenant(tenantId, accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    return account;
  }

  public async listAccounts(
    query: AccountPaginationQuery,
  ): Promise<PaginatedResult<AccountEntity>> {
    validatePaginationQuery(query);

    if (query.ledgerId !== undefined) {
      assertNonEmpty(query.ledgerId, 'ledgerId must be a non-empty string');
    }

    return this.repository.listAccounts(query);
  }

  public async listTransactions(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    validatePaginationQuery(query);
    if (query.ledgerId !== undefined) {
      assertNonEmpty(query.ledgerId, 'ledgerId must be a non-empty string');
    }
    return this.repository.listTransactions(query);
  }

  public async getTransactionById(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(transactionId, 'transaction id is required');

    const transaction = await this.repository.findTransactionByIdForTenant(tenantId, transactionId);
    if (!transaction) {
      throw new TransactionNotFoundError(transactionId);
    }

    return transaction;
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    validatePaginationQuery(query);
    return this.repository.listEntries(query);
  }

  public async getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.ledgerId, 'ledgerId is required');

    return this.repository.getLedgerTrialBalance(query);
  }

  public async getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.accountId, 'accountId is required');
    if (!(query.at instanceof Date) || Number.isNaN(query.at.getTime())) {
      throw new InvariantViolationError('at must be a valid ISO-8601 timestamp');
    }
    return this.repository.getBalanceAt(query);
  }

  public async listBalanceHistory(
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
    return this.repository.listBalanceHistory(query);
  }

  private assertAccountSide(side: string): void {
    if (!(Object.values(AccountSide) as string[]).includes(side)) {
      throw new InvariantViolationError('account side must be DEBIT or CREDIT');
    }
  }
}
