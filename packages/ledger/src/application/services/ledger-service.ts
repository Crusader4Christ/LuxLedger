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
  CreateAccountInput,
  CreateLedgerInput,
  CreateTransactionInput,
  CreateTransactionResult,
  Ledger,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
  TransactionPaginationQuery,
  TrialBalance,
  TrialBalanceQuery,
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

  public async getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.ledgerId, 'ledgerId is required');

    return this.repository.getTrialBalance(query);
  }

  private assertAccountSide(side: string): void {
    if (!(Object.values(AccountSide) as string[]).includes(side)) {
      throw new InvariantViolationError('account side must be DEBIT or CREDIT');
    }
  }
}
