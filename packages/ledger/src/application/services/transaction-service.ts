import type { EntryEntity } from '../../entry/entity';
import type { TransactionEntity } from '../../transaction/entity';
import { assertNonEmpty } from '../../utils';
import { BulkTransactionError, InvariantViolationError, TransactionNotFoundError } from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type { TransactionApplicationRepository } from '../repositories.interface';
import type {
  BulkCreateTransactionInput,
  BulkCreateTransactionResult,
  CorrectTransactionInput,
  CorrectTransactionResult,
  CreateTransactionInput,
  CreateTransactionResult,
  PaginatedResult,
  PaginationQuery,
  ReverseTransactionInput,
  ReverseTransactionResult,
  TransactionPaginationQuery,
} from '../types';

export class TransactionService {
  public constructor(private readonly repository: TransactionApplicationRepository) {}

  public async create(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    this.validateCreateInput(input);
    return this.repository.create(input);
  }

  public async createBulk(input: BulkCreateTransactionInput): Promise<BulkCreateTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    if (input.transactions.length === 0) {
      throw new InvariantViolationError('at least one transaction is required');
    }

    const references = new Set<string>();
    for (const [itemIndex, transaction] of input.transactions.entries()) {
      try {
        this.validateCreateInput(transaction);
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
    return this.repository.createBulk(input);
  }

  public async reverse(input: ReverseTransactionInput): Promise<ReverseTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.transactionId, 'transactionId is required');
    assertNonEmpty(input.reference, 'reference is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    return this.repository.reverse(input);
  }

  public async correct(input: CorrectTransactionInput): Promise<CorrectTransactionResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.transactionId, 'transactionId is required');
    assertNonEmpty(input.reversalReference, 'reversalReference is required');
    assertNonEmpty(input.correctedReference, 'correctedReference is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    return this.repository.correct(input);
  }

  public async list(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    validatePaginationQuery(query);
    if (query.ledgerId !== undefined) {
      assertNonEmpty(query.ledgerId, 'ledgerId must be a non-empty string');
    }
    return this.repository.list(query);
  }

  public async getById(tenantId: string, transactionId: string): Promise<TransactionEntity> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(transactionId, 'transaction id is required');
    const transaction = await this.repository.findById(tenantId, transactionId);
    if (!transaction) {
      throw new TransactionNotFoundError(transactionId);
    }
    return transaction;
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    validatePaginationQuery(query);
    return this.repository.listEntries(query);
  }

  private validateCreateInput(input: CreateTransactionInput): void {
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
