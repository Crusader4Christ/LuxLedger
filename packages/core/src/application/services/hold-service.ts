import { assertNonEmpty } from '../../utils';
import { InvariantViolationError } from '../errors';
import type { HoldApplicationRepository } from '../repositories.interface';
import type {
  CommitHoldInput,
  CommitHoldResult,
  CreateHoldInput,
  CreateHoldResult,
  VoidHoldInput,
  VoidHoldResult,
} from '../types';

export class HoldService {
  public constructor(private readonly repository: HoldApplicationRepository) {}

  public async create(input: CreateHoldInput): Promise<CreateHoldResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.reference, 'reference is required');
    assertNonEmpty(input.currency, 'currency is required');
    if (typeof input.description === 'string') {
      assertNonEmpty(input.description, 'description must be a non-empty string');
    }
    return this.repository.create(input);
  }

  public async commit(input: CommitHoldInput): Promise<CommitHoldResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.holdId, 'holdId is required');
    assertNonEmpty(input.reference, 'reference is required');
    if (input.amountMinor !== undefined && input.amountMinor <= 0n) {
      throw new InvariantViolationError('amountMinor must be positive when provided');
    }
    return this.repository.commit(input);
  }

  public async void(input: VoidHoldInput): Promise<VoidHoldResult> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.holdId, 'holdId is required');
    return this.repository.void(input);
  }
}
