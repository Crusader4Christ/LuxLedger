import { validateCreditGrant } from '../../credit-grant';
import { assertNonEmpty } from '../../utils';
import { CreditGrantNotFoundError, InvariantViolationError } from '../errors';
import { validatePaginationQuery } from '../pagination-query';
import type { CreditGrantRepository } from '../repositories.interface';
import type {
  CreateCreditGrantInput,
  CreditBalance,
  CreditGrant,
  CreditGrantExpirationResult,
  CreditGrantLineage,
  CreditGrantListQuery,
  CreditGrantLotBalance,
  CreditGrantResult,
  CreditLotListQuery,
  PaginatedResult,
  PaginationQuery,
  ProcessCreditGrantExpirationsInput,
  ReverseCreditGrantInput,
} from '../types';

export class CreditGrantService {
  public constructor(private readonly repository: CreditGrantRepository) {}

  public async create(input: CreateCreditGrantInput): Promise<CreditGrantResult> {
    for (const [name, value] of Object.entries({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      accountId: input.accountId,
      fundingAccountId: input.fundingAccountId,
      reference: input.reference,
    }))
      assertNonEmpty(value, `${name} is required`);
    if (input.externalReference != null) {
      assertNonEmpty(input.externalReference, 'externalReference must not be empty');
    }
    if (input.expiresAt && Number.isNaN(input.expiresAt.getTime())) {
      throw new InvariantViolationError('expiresAt must be a valid timestamp');
    }
    validateCreditGrant(input);
    if (input.accountId === input.fundingAccountId) {
      throw new InvariantViolationError('Grant account and funding account must differ');
    }
    return this.repository.create(input);
  }

  public async reverse(input: ReverseCreditGrantInput): Promise<CreditGrantResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.grantId, 'grantId is required');
    assertNonEmpty(input.reference, 'reference is required');
    return this.repository.reverse(input);
  }

  public async getById(tenantId: string, grantId: string): Promise<CreditGrant> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(grantId, 'grantId is required');
    const grant = await this.repository.findById(tenantId, grantId);
    if (!grant) throw new CreditGrantNotFoundError(grantId);
    return grant;
  }

  public async getBalance(tenantId: string, accountId: string): Promise<CreditBalance> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(accountId, 'accountId is required');
    return this.repository.getBalance(tenantId, accountId);
  }

  public async list(query: CreditGrantListQuery): Promise<PaginatedResult<CreditGrant>> {
    validatePaginationQuery(query);
    for (const [name, value] of Object.entries({
      accountId: query.accountId,
      reference: query.reference,
      externalReference: query.externalReference,
    })) {
      if (value !== undefined) assertNonEmpty(value, `${name} must not be empty`);
    }
    return this.repository.list(query);
  }

  public async listLots(
    query: CreditLotListQuery,
  ): Promise<PaginatedResult<CreditGrantLotBalance>> {
    validatePaginationQuery(query);
    assertNonEmpty(query.accountId, 'accountId is required');
    return this.repository.listLots(query);
  }

  public async listLineageByGrant(
    query: PaginationQuery & { grantId: string },
  ): Promise<PaginatedResult<CreditGrantLineage>> {
    validatePaginationQuery(query);
    assertNonEmpty(query.grantId, 'grantId is required');
    return this.repository.listLineage(query);
  }

  public async listLineageByTransaction(
    query: PaginationQuery & { transactionId: string },
  ): Promise<PaginatedResult<CreditGrantLineage>> {
    validatePaginationQuery(query);
    assertNonEmpty(query.transactionId, 'transactionId is required');
    return this.repository.listLineage(query);
  }

  public async previewExpirations(
    input: ProcessCreditGrantExpirationsInput,
  ): Promise<CreditGrantExpirationResult> {
    this.validateExpirationInput(input);
    return this.repository.previewExpirations(input);
  }

  public async runExpirations(
    input: ProcessCreditGrantExpirationsInput,
  ): Promise<CreditGrantExpirationResult> {
    this.validateExpirationInput(input);
    return this.repository.runExpirations(input);
  }

  private validateExpirationInput(input: ProcessCreditGrantExpirationsInput): void {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    if (Number.isNaN(input.asOf.getTime())) {
      throw new InvariantViolationError('asOf must be a valid timestamp');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new InvariantViolationError('limit must be an integer between 1 and 100');
    }
  }
}
