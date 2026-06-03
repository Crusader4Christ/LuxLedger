import type { TransactionEntity } from '../transaction/entity';

export type ReconciliationStrategy = 'one_to_one';
export type ReconciliationRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ReconciliationResultStatus =
  | 'matched'
  | 'unmatched_external'
  | 'unmatched_internal'
  | 'mismatched'
  | 'conflict';
export type ReconciliationMatchField = 'amount' | 'currency' | 'date' | 'reference' | 'description';
export type ReconciliationMatchOperator = 'equals' | 'contains';

export interface ExternalReconciliationRecord {
  id: string;
  tenantId: string;
  uploadId: string;
  externalId: string;
  source: string;
  amountMinor: bigint;
  currency: string;
  reference: string;
  description: string | null;
  occurredAt: Date;
  raw: Record<string, unknown> | null;
}

export interface ReconciliationMatchingCriterion {
  field: ReconciliationMatchField;
  operator: ReconciliationMatchOperator;
  amountToleranceMinor?: bigint;
  dateToleranceSeconds?: number;
}

export interface ReconciliationMatchingRule {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  criteria: ReconciliationMatchingCriterion[];
  createdAt: Date;
}

export interface ReconciliationMatchCandidate {
  transactionId: string;
  reasons: string[];
}

export interface ReconciliationMatchDecision {
  externalRecordId?: string;
  externalId?: string;
  transactionId?: string;
  status: ReconciliationResultStatus;
  reason: string;
  candidateTransactionIds: string[];
}

const transactionAmountMinor = (transaction: TransactionEntity): bigint =>
  transaction.entries
    .filter((entry) => entry.direction === 'DEBIT')
    .reduce((sum, entry) => sum + entry.money.amountMinor, 0n);

const normalize = (value: string): string => value.trim().toLowerCase();

const matchString = (
  externalValue: string | null,
  internalValue: string | null,
  operator: ReconciliationMatchOperator,
): boolean => {
  if (externalValue === null || internalValue === null) {
    return externalValue === internalValue;
  }

  if (operator === 'equals') {
    return normalize(externalValue) === normalize(internalValue);
  }

  return normalize(internalValue).includes(normalize(externalValue));
};

const dateDeltaSeconds = (left: Date, right: Date): number =>
  Math.abs(left.getTime() - right.getTime()) / 1000;

const matchCriterion = (
  externalRecord: ExternalReconciliationRecord,
  transaction: TransactionEntity,
  criterion: ReconciliationMatchingCriterion,
): boolean => {
  switch (criterion.field) {
    case 'amount': {
      const tolerance = criterion.amountToleranceMinor ?? 0n;
      const delta = externalRecord.amountMinor - transactionAmountMinor(transaction);
      return (delta < 0n ? -delta : delta) <= tolerance;
    }
    case 'currency':
      return matchString(externalRecord.currency, transaction.currency, criterion.operator);
    case 'date': {
      if (!transaction.createdAt) {
        return false;
      }
      return (
        dateDeltaSeconds(externalRecord.occurredAt, transaction.createdAt) <=
        (criterion.dateToleranceSeconds ?? 0)
      );
    }
    case 'reference':
      return matchString(externalRecord.reference, transaction.reference, criterion.operator);
    case 'description':
      return matchString(externalRecord.description, transaction.description, criterion.operator);
  }
};

const candidateMismatchReasons = (
  externalRecord: ExternalReconciliationRecord,
  transaction: TransactionEntity,
  criteria: ReconciliationMatchingCriterion[],
): string[] =>
  criteria
    .filter((criterion) => !matchCriterion(externalRecord, transaction, criterion))
    .map((criterion) => `${criterion.field}_mismatch`);

const findReferenceCandidates = (
  externalRecord: ExternalReconciliationRecord,
  transactions: TransactionEntity[],
  criteria: ReconciliationMatchingCriterion[],
): ReconciliationMatchCandidate[] =>
  transactions
    .filter((transaction) => matchString(externalRecord.reference, transaction.reference, 'equals'))
    .map((transaction) => ({
      transactionId: transaction.id.value,
      reasons: candidateMismatchReasons(externalRecord, transaction, criteria),
    }));

export const reconcileOneToOne = (input: {
  externalRecords: ExternalReconciliationRecord[];
  transactions: TransactionEntity[];
  rules: ReconciliationMatchingRule[];
}): ReconciliationMatchDecision[] => {
  const criteria = input.rules.flatMap((rule) => rule.criteria);
  const decisionsByExternalRecordId = new Map<string, ReconciliationMatchDecision>();
  const matchedByTransactionId = new Map<string, ReconciliationMatchDecision[]>();

  for (const externalRecord of [...input.externalRecords].sort((left, right) => {
    const dateDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
    return dateDelta === 0 ? left.externalId.localeCompare(right.externalId) : dateDelta;
  })) {
    const candidates = input.transactions
      .filter((transaction) =>
        criteria.every((criterion) => matchCriterion(externalRecord, transaction, criterion)),
      )
      .sort((left, right) => left.id.value.localeCompare(right.id.value));

    if (candidates.length === 1) {
      const decision: ReconciliationMatchDecision = {
        externalRecordId: externalRecord.id,
        externalId: externalRecord.externalId,
        transactionId: candidates[0].id.value,
        status: 'matched',
        reason: 'all_criteria_matched',
        candidateTransactionIds: [candidates[0].id.value],
      };
      decisionsByExternalRecordId.set(externalRecord.id, decision);
      const existing = matchedByTransactionId.get(candidates[0].id.value) ?? [];
      existing.push(decision);
      matchedByTransactionId.set(candidates[0].id.value, existing);
      continue;
    }

    if (candidates.length > 1) {
      decisionsByExternalRecordId.set(externalRecord.id, {
        externalRecordId: externalRecord.id,
        externalId: externalRecord.externalId,
        status: 'conflict',
        reason: 'multiple_internal_candidates',
        candidateTransactionIds: candidates.map((candidate) => candidate.id.value),
      });
      continue;
    }

    const referenceCandidates = findReferenceCandidates(
      externalRecord,
      input.transactions,
      criteria,
    );
    if (referenceCandidates.length > 0) {
      decisionsByExternalRecordId.set(externalRecord.id, {
        externalRecordId: externalRecord.id,
        externalId: externalRecord.externalId,
        status: 'mismatched',
        reason:
          referenceCandidates
            .flatMap((candidate) =>
              candidate.reasons.length > 0 ? candidate.reasons : ['criteria_mismatch'],
            )
            .sort()
            .join(',') || 'criteria_mismatch',
        candidateTransactionIds: referenceCandidates.map((candidate) => candidate.transactionId),
      });
      continue;
    }

    decisionsByExternalRecordId.set(externalRecord.id, {
      externalRecordId: externalRecord.id,
      externalId: externalRecord.externalId,
      status: 'unmatched_external',
      reason: 'no_internal_candidate',
      candidateTransactionIds: [],
    });
  }

  for (const decisions of matchedByTransactionId.values()) {
    if (decisions.length <= 1) {
      continue;
    }

    for (const decision of decisions) {
      decisionsByExternalRecordId.set(decision.externalRecordId as string, {
        ...decision,
        transactionId: undefined,
        status: 'conflict',
        reason: 'multiple_external_candidates',
        candidateTransactionIds: [decision.transactionId as string],
      });
    }
  }

  const referencedTransactionIds = new Set<string>();
  for (const decision of decisionsByExternalRecordId.values()) {
    if (decision.transactionId) {
      referencedTransactionIds.add(decision.transactionId);
    }
    for (const candidateTransactionId of decision.candidateTransactionIds) {
      referencedTransactionIds.add(candidateTransactionId);
    }
  }

  const externalDecisions = [...decisionsByExternalRecordId.values()];
  const unmatchedInternalDecisions = input.transactions
    .filter((transaction) => !referencedTransactionIds.has(transaction.id.value))
    .sort((left, right) => left.id.value.localeCompare(right.id.value))
    .map(
      (transaction): ReconciliationMatchDecision => ({
        transactionId: transaction.id.value,
        status: 'unmatched_internal',
        reason: 'no_external_candidate',
        candidateTransactionIds: [],
      }),
    );

  return [...externalDecisions, ...unmatchedInternalDecisions];
};
