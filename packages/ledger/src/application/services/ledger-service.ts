import { type AccountEntity, AccountSide, OverdraftPolicy } from '../../account/entity';
import type { EntryEntity } from '../../entry/entity';
import type { TransactionEntity } from '../../transaction/entity';
import { assertNonEmpty } from '../../utils';
import {
  AccountNotFoundError,
  BulkTransactionError,
  InvariantViolationError,
  LedgerNotFoundError,
  ReconRunNotFoundError,
  TransactionNotFoundError,
} from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type {
  AccountPaginationQuery,
  BalanceAtQuery,
  BalanceHistoryQuery,
  BalanceSnapshotEvent,
  BulkCreateTransactionInput,
  BulkCreateTransactionResult,
  CommitHoldInput,
  CommitHoldResult,
  CorrectTransactionInput,
  CorrectTransactionResult,
  CreateAccountInput,
  CreateHoldInput,
  CreateHoldResult,
  CreateLedgerInput,
  CreateReconRuleInput,
  CreateTransactionInput,
  CreateTransactionResult,
  HistoricalBalance,
  IngestReconRecordsInput,
  Ledger,
  LedgerRepository,
  LedgerTrialBalanceQuery,
  PaginatedResult,
  PaginationQuery,
  ReconRule,
  ReconRun,
  ReconUpload,
  ReverseTransactionInput,
  ReverseTransactionResult,
  RunReconInput,
  TransactionPaginationQuery,
  TrialBalance,
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
    this.validateCreateTransactionInput(input);

    return this.repository.createTransaction(input);
  }

  public async createTransactionsBulk(
    input: BulkCreateTransactionInput,
  ): Promise<BulkCreateTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    if (input.transactions.length === 0) {
      throw new InvariantViolationError('at least one transaction is required');
    }

    const references = new Set<string>();
    for (const [itemIndex, transaction] of input.transactions.entries()) {
      try {
        this.validateCreateTransactionInput(transaction);
        if (transaction.tenantId !== input.tenantId) {
          throw new InvariantViolationError('transaction tenantId must match bulk tenantId');
        }
        if (references.has(transaction.reference)) {
          throw new InvariantViolationError('duplicate transaction reference in bulk request');
        }
        references.add(transaction.reference);
      } catch (error) {
        throw new BulkTransactionError({
          itemIndex,
          reference: transaction.reference,
          category: 'VALIDATION',
          message: error instanceof Error ? error.message : 'Invalid transaction input',
          cause: error,
        });
      }
    }

    return this.repository.createTransactionsBulk(input);
  }

  public async reverseTransaction(
    input: ReverseTransactionInput,
  ): Promise<ReverseTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.transactionId, 'transactionId is required');
    assertNonEmpty(input.reference, 'reference is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    return this.repository.reverseTransaction(input);
  }

  public async correctTransaction(
    input: CorrectTransactionInput,
  ): Promise<CorrectTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.transactionId, 'transactionId is required');
    assertNonEmpty(input.reversalReference, 'reversalReference is required');
    assertNonEmpty(input.correctedReference, 'correctedReference is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    return this.repository.correctTransaction(input);
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
    if (input.overdraftPolicy !== undefined) {
      this.assertOverdraftPolicy(input.overdraftPolicy);
    }

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

  public async ingestExternalRecords(input: IngestReconRecordsInput): Promise<ReconUpload> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.source, 'source is required');
    if (input.records.length === 0) {
      throw new InvariantViolationError('at least one external record is required');
    }

    for (const record of input.records) {
      assertNonEmpty(record.externalId, 'external record id is required');
      assertNonEmpty(record.currency, 'external record currency is required');
      assertNonEmpty(record.reference, 'external record reference is required');
      if (record.amountMinor <= 0n) {
        throw new InvariantViolationError('external record amountMinor must be positive');
      }
      if (!(record.occurredAt instanceof Date) || Number.isNaN(record.occurredAt.getTime())) {
        throw new InvariantViolationError('external record occurredAt must be a valid timestamp');
      }
    }

    return this.repository.ingestExternalRecords(input);
  }

  public async createReconciliationMatchingRule(input: CreateReconRuleInput): Promise<ReconRule> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.name, 'name is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    if (input.criteria.length === 0) {
      throw new InvariantViolationError('at least one matching criterion is required');
    }
    for (const criterion of input.criteria) {
      if (!['amount', 'currency', 'date', 'reference', 'description'].includes(criterion.field)) {
        throw new InvariantViolationError('matching criterion field is invalid');
      }
      if (!['equals', 'contains'].includes(criterion.operator)) {
        throw new InvariantViolationError('matching criterion operator is invalid');
      }
      if (
        (criterion.field === 'amount' || criterion.field === 'date') &&
        criterion.operator !== 'equals'
      ) {
        throw new InvariantViolationError('amount and date criteria only support equals operator');
      }
      if (criterion.field !== 'amount' && criterion.amountToleranceMinor !== undefined) {
        throw new InvariantViolationError('amount tolerance is only valid for amount criteria');
      }
      if (criterion.field !== 'date' && criterion.dateToleranceSeconds !== undefined) {
        throw new InvariantViolationError('date tolerance is only valid for date criteria');
      }
      if (criterion.amountToleranceMinor !== undefined && criterion.amountToleranceMinor < 0n) {
        throw new InvariantViolationError('amount tolerance must be non-negative');
      }
      if (criterion.dateToleranceSeconds !== undefined && criterion.dateToleranceSeconds < 0) {
        throw new InvariantViolationError('date tolerance must be non-negative');
      }
    }

    return this.repository.createReconciliationMatchingRule(input);
  }

  public async listReconciliationMatchingRules(tenantId: string): Promise<ReconRule[]> {
    assertNonEmpty(tenantId, 'tenantId is required');
    return this.repository.listReconciliationMatchingRules(tenantId);
  }

  public async runReconciliation(input: RunReconInput): Promise<ReconRun> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.uploadId, 'uploadId is required');
    if (input.strategy !== 'one_to_one') {
      throw new InvariantViolationError('only one_to_one reconciliation is supported');
    }
    if (input.matchingRuleIds.length === 0) {
      throw new InvariantViolationError('at least one matching rule is required');
    }
    return this.repository.runReconciliation(input);
  }

  public async getReconciliationRun(tenantId: string, runId: string): Promise<ReconRun> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(runId, 'reconciliation run id is required');
    const run = await this.repository.getReconciliationRun(tenantId, runId);
    if (!run) {
      throw new ReconRunNotFoundError(runId);
    }
    return run;
  }

  private assertAccountSide(side: string): void {
    if (!(Object.values(AccountSide) as string[]).includes(side)) {
      throw new InvariantViolationError('account side must be DEBIT or CREDIT');
    }
  }

  private assertOverdraftPolicy(policy: string): void {
    if (!(Object.values(OverdraftPolicy) as string[]).includes(policy)) {
      throw new InvariantViolationError('overdraft policy must be ALLOW or DISALLOW');
    }
  }

  private validateCreateTransactionInput(input: CreateTransactionInput): void {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.reference, 'reference is required');
    assertNonEmpty(input.currency, 'currency is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    if (
      input.effectiveAt !== undefined &&
      input.effectiveAt !== null &&
      (!(input.effectiveAt instanceof Date) || Number.isNaN(input.effectiveAt.getTime()))
    ) {
      throw new InvariantViolationError('effectiveAt must be a valid ISO-8601 timestamp');
    }
  }
}
