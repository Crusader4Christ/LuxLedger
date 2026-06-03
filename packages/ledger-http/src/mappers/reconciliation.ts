import type {
  ReconciliationExternalUpload,
  ReconciliationMatchingCriterion,
  ReconciliationMatchingRule,
  ReconciliationResult,
  ReconciliationRun,
} from '@lux/ledger/application';
import type {
  ExternalRecordsUploadResponse,
  ReconciliationCriterionRequest,
  ReconciliationMatchingRuleResponse,
  ReconciliationResultResponse,
  ReconciliationRunResponse,
} from '../contracts/reconciliation';

const toCriterionResponse = (
  criterion: ReconciliationMatchingCriterion,
): ReconciliationCriterionRequest => ({
  field: criterion.field,
  operator: criterion.operator,
  amount_tolerance_minor: criterion.amountToleranceMinor?.toString(),
  date_tolerance_seconds: criterion.dateToleranceSeconds,
});

export const toReconciliationMatchingRuleResponse = (
  rule: ReconciliationMatchingRule,
): ReconciliationMatchingRuleResponse => ({
  id: rule.id,
  tenant_id: rule.tenantId,
  name: rule.name,
  description: rule.description,
  criteria: rule.criteria.map(toCriterionResponse),
  created_at: rule.createdAt.toISOString(),
});

export const toExternalRecordsUploadResponse = (
  upload: ReconciliationExternalUpload,
): ExternalRecordsUploadResponse => ({
  upload_id: upload.id,
  tenant_id: upload.tenantId,
  source: upload.source,
  record_count: upload.recordCount,
  created_at: upload.createdAt.toISOString(),
});

export const toReconciliationResultResponse = (
  result: ReconciliationResult,
): ReconciliationResultResponse => ({
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

export const toReconciliationRunResponse = (run: ReconciliationRun): ReconciliationRunResponse => ({
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
  results: run.results.map(toReconciliationResultResponse),
});
