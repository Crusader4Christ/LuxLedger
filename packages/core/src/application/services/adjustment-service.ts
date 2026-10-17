import { assertNonEmpty } from '../../utils';
import { InvariantViolationError } from '../errors';
import type { AdjustmentRepository } from '../repositories.interface';
import type { AdjustmentResult, CreateAdjustmentInput } from '../types';

const MAX_INT64 = 9_223_372_036_854_775_807n;

export class AdjustmentService {
  public constructor(private readonly repository: AdjustmentRepository) {}

  public credit(input: CreateAdjustmentInput): Promise<AdjustmentResult> {
    this.validate(input);
    return this.repository.create('CREDIT', input);
  }

  public debit(input: CreateAdjustmentInput): Promise<AdjustmentResult> {
    this.validate(input);
    return this.repository.create('DEBIT', input);
  }

  private validate(input: CreateAdjustmentInput): void {
    for (const [name, value] of Object.entries({
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      accountId: input.accountId,
      offsetAccountId: input.offsetAccountId,
      reference: input.reference,
      description: input.description,
      reasonCode: input.reasonCode,
      actorId: input.actorId,
    })) {
      assertNonEmpty(value, `${name} is required`);
    }
    if (input.accountId === input.offsetAccountId) {
      throw new InvariantViolationError('Adjustment account and offset account must differ');
    }
    if (input.amountMinor <= 0n || input.amountMinor > MAX_INT64) {
      throw new InvariantViolationError(
        'Adjustment amount must be a positive int64 minor-unit value',
      );
    }
  }
}
