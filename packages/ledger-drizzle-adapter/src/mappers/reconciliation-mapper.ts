import type { ReconMatchCriterion, ReconRecord, ReconRule, ReconStrategy } from '@lux/ledger';
import type { ReconResult, ReconRun } from '@lux/ledger/application';
import type * as schema from '../schema';

type ReconRecordRow = typeof schema.reconRecords.$inferSelect;
type ReconRuleRow = typeof schema.reconRules.$inferSelect;
type ReconRunRow = typeof schema.reconRuns.$inferSelect;
type ReconResultRow = typeof schema.reconResults.$inferSelect;

export const serializeMatchingCriteria = (
  criteria: ReconMatchCriterion[],
): ReconRuleRow['criteria'] =>
  criteria.map((criterion) => ({
    field: criterion.field,
    operator: criterion.operator,
    amountToleranceMinor: criterion.amountToleranceMinor?.toString(),
    dateToleranceSeconds: criterion.dateToleranceSeconds,
  }));

const parseMatchingCriteria = (criteria: ReconRuleRow['criteria']): ReconMatchCriterion[] =>
  criteria.map((criterion) => ({
    field: criterion.field as ReconMatchCriterion['field'],
    operator: criterion.operator as ReconMatchCriterion['operator'],
    amountToleranceMinor:
      criterion.amountToleranceMinor === undefined
        ? undefined
        : BigInt(criterion.amountToleranceMinor),
    dateToleranceSeconds: criterion.dateToleranceSeconds,
  }));

export const toReconRule = (row: ReconRuleRow): ReconRule => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  description: row.description,
  criteria: parseMatchingCriteria(row.criteria),
  createdAt: row.createdAt,
});

export const toReconRecord = (row: ReconRecordRow): ReconRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  uploadId: row.uploadId,
  externalId: row.externalId,
  source: row.source,
  amountMinor: row.amountMinor,
  currency: row.currency,
  reference: row.reference,
  description: row.description,
  occurredAt: row.occurredAt,
  raw: row.raw ?? null,
});

export const toReconRun = (run: ReconRunRow, resultRows: ReconResultRow[]): ReconRun => ({
  id: run.id,
  tenantId: run.tenantId,
  ledgerId: run.ledgerId,
  uploadId: run.uploadId,
  strategy: run.strategy as ReconStrategy,
  status: run.status,
  dryRun: run.dryRun,
  matchedCount: run.matchedCount,
  unmatchedExternalCount: run.unmatchedExternalCount,
  unmatchedInternalCount: run.unmatchedInternalCount,
  mismatchedCount: run.mismatchedCount,
  conflictCount: run.conflictCount,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
  results: resultRows.map(
    (row): ReconResult => ({
      id: row.id,
      runId: row.runId,
      externalRecordId: row.externalRecordId,
      externalId: row.externalId,
      transactionId: row.transactionId,
      status: row.status,
      reason: row.reason,
      candidateTransactionIds: row.candidateTransactionIds,
      createdAt: row.createdAt,
    }),
  ),
});
