import type { EntryEntity, TransactionEntity } from '@lux/ledger';
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
  TransactionApplicationRepository,
  TransactionPaginationQuery,
} from '@lux/ledger/application';
import type { DrizzleRepositoryContext } from '../repository-context';
import { DrizzleTransactionStore } from './transaction-store';

export class DrizzleTransactionRepository implements TransactionApplicationRepository {
  private readonly store: DrizzleTransactionStore;

  public constructor(
    context: DrizzleRepositoryContext,
    store = new DrizzleTransactionStore(context),
  ) {
    this.store = store;
  }

  public create(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    return this.store.createTransaction(input);
  }

  public createBulk(input: BulkCreateTransactionInput): Promise<BulkCreateTransactionResult> {
    return this.store.createTransactionsBulk(input);
  }

  public reverse(input: ReverseTransactionInput): Promise<ReverseTransactionResult> {
    return this.store.reverseTransaction(input);
  }

  public correct(input: CorrectTransactionInput): Promise<CorrectTransactionResult> {
    return this.store.correctTransaction(input);
  }

  public findById(tenantId: string, transactionId: string): Promise<TransactionEntity | null> {
    return this.store.findTransaction(tenantId, transactionId);
  }

  public list(query: TransactionPaginationQuery): Promise<PaginatedResult<TransactionEntity>> {
    return this.store.listTransactions(query);
  }

  public listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    return this.store.listEntries(query);
  }
}
