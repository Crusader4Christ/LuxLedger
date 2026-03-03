import type { AccountEntity, EntryEntity, TransactionEntity } from '@lux/ledger';
import { assertNonEmpty } from '@lux/ledger/utils';
import { InvariantViolationError, LedgerNotFoundError } from '@services/errors';
import type {
  CreateLedgerInput,
  CreateTransactionInput,
  CreateTransactionResult,
  Ledger,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
  TrialBalance,
  TrialBalanceQuery,
} from '@services/types';

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

    return this.repository.createTransaction(input);
  }

  public async listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountEntity>> {
    this.validateQuery(query);
    return this.repository.listAccounts(query);
  }

  public async listTransactions(
    query: PaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    this.validateQuery(query);
    return this.repository.listTransactions(query);
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    this.validateQuery(query);
    return this.repository.listEntries(query);
  }

  public async getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance> {
    assertNonEmpty(query.tenantId, 'tenantId is required');
    assertNonEmpty(query.ledgerId, 'ledgerId is required');

    return this.repository.getTrialBalance(query);
  }

  private validateQuery(query: PaginationQuery): void {
    assertNonEmpty(query.tenantId, 'tenantId is required');

    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) {
      throw new InvariantViolationError('limit must be an integer between 1 and 200');
    }

    if (query.cursor !== undefined && query.cursor.trim().length === 0) {
      throw new InvariantViolationError('cursor must be a non-empty string');
    }
  }
}
