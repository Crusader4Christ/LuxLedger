import type {
  ReconMatchCriterion,
  ReconResult,
  ReconRule,
  ReconRun,
  ReconUpload,
} from '@lux/ledger/application';
import type {
  ReconUploadResponse,
  ReconCriterionRequest,
  ReconResultResponse,
  ReconRuleResponse,
  ReconRunResponse,
} from '../contracts/reconciliation';

const toCriterionResponse = (criterion: ReconMatchCriterion): ReconCriterionRequest => ({
  field: criterion.field,
  operator: criterion.operator,
  amount_tolerance_minor: criterion.amountToleranceMinor?.toString(),
  date_tolerance_seconds: criterion.dateToleranceSeconds,
});

export const toReconRuleResponse = (rule: ReconRule): ReconRuleResponse => ({
  id: rule.id,
  tenant_id: rule.tenantId,
  name: rule.name,
  description: rule.description,
  criteria: rule.criteria.map(toCriterionResponse),
  created_at: rule.createdAt.toISOString(),
});

export const toReconUploadResponse = (upload: ReconUpload): ReconUploadResponse => ({
  upload_id: upload.id,
  tenant_id: upload.tenantId,
  source: upload.source,
  record_count: upload.recordCount,
  created_at: upload.createdAt.toISOString(),
});

export const toReconResultResponse = (result: ReconResult): ReconResultResponse => ({
  id: result.id,
  run_id: result.runId,
  external_record_id: result.externalRecordId,
  external_id: result.externalId,
  transaction_id: result.transactionId,
  status: result.status,
  reason: result.reason,
  candidate_transaction_ids: result.candidateTransactionIds,
  created_at: result.createdAt.toISOString(),
});

export const toReconRunResponse = (run: ReconRun): ReconRunResponse => ({
  id: run.id,
  tenant_id: run.tenantId,
  ledger_id: run.ledgerId,
  upload_id: run.uploadId,
  strategy: run.strategy,
  status: run.status,
  dry_run: run.dryRun,
  matched_count: run.matchedCount,
  unmatched_external_count: run.unmatchedExternalCount,
  unmatched_internal_count: run.unmatchedInternalCount,
  mismatched_count: run.mismatchedCount,
  conflict_count: run.conflictCount,
  started_at: run.startedAt.toISOString(),
  completed_at: run.completedAt?.toISOString() ?? null,
  results: run.results.map(toReconResultResponse),
});
