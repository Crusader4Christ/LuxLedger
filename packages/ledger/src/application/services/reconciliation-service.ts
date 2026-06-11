import { assertNonEmpty } from '../../utils';
import { InvariantViolationError, ReconRunNotFoundError } from '../errors';
import type { ReconciliationApplicationRepository } from '../repositories.interface';
import type {
  CreateReconRuleInput,
  IngestReconRecordsInput,
  ReconRule,
  ReconRun,
  ReconUpload,
  RunReconInput,
} from '../types';

export class ReconciliationService {
  public constructor(private readonly repository: ReconciliationApplicationRepository) {}

  public async ingest(input: IngestReconRecordsInput): Promise<ReconUpload> {
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
    return this.repository.ingest(input);
  }

  public async createRule(input: CreateReconRuleInput): Promise<ReconRule> {
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
    return this.repository.createRule(input);
  }

  public async listRules(tenantId: string): Promise<ReconRule[]> {
    assertNonEmpty(tenantId, 'tenantId is required');
    return this.repository.listRules(tenantId);
  }

  public async run(input: RunReconInput): Promise<ReconRun> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.ledgerId, 'ledgerId is required');
    assertNonEmpty(input.uploadId, 'uploadId is required');
    if (input.strategy !== 'one_to_one') {
      throw new InvariantViolationError('only one_to_one reconciliation is supported');
    }
    if (input.matchingRuleIds.length === 0) {
      throw new InvariantViolationError('at least one matching rule is required');
    }
    return this.repository.run(input);
  }

  public async getRun(tenantId: string, runId: string): Promise<ReconRun> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(runId, 'reconciliation run id is required');
    const run = await this.repository.getRun(tenantId, runId);
    if (!run) {
      throw new ReconRunNotFoundError(runId);
    }
    return run;
  }
}
