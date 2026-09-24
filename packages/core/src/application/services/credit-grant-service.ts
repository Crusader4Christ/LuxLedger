import { validateCreditGrant } from '../../credit-grant';
import { assertNonEmpty } from '../../utils';
import { CreditGrantNotFoundError, InvariantViolationError } from '../errors';
import type { CreditGrantRepository } from '../repositories.interface';
import type {
  CreateCreditGrantInput,
  CreditBalance,
  CreditGrant,
  CreditGrantResult,
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
      provenance: input.provenance,
    }))
      assertNonEmpty(value, `${name} is required`);
    if (input.externalReference != null) {
      assertNonEmpty(input.externalReference, 'externalReference must not be empty');
    }
    if (input.expiresAt != null && !(input.expiresAt instanceof Date)) {
      throw new InvariantViolationError('expiresAt must be a Date');
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
}
