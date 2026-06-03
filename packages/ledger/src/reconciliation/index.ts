import type { TransactionEntity } from '../transaction/entity';

export type ReconStrategy = 'one_to_one';
export type ReconRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ReconResultStatus =
  | 'matched'
  | 'unmatched_external'
  | 'unmatched_internal'
  | 'mismatched'
  | 'conflict';
export type ReconMatchField = 'amount' | 'currency' | 'date' | 'reference' | 'description';
export type ReconMatchOperator = 'equals' | 'contains';

export interface ReconRecord {
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

export interface ReconMatchCriterion {
  field: ReconMatchField;
  operator: ReconMatchOperator;
  amountToleranceMinor?: bigint;
  dateToleranceSeconds?: number;
}

export interface ReconRule {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  criteria: ReconMatchCriterion[];
  createdAt: Date;
}

export interface ReconMatchCandidate {
  transactionId: string;
  reasons: string[];
}

export interface ReconMatchDecision {
  externalRecordId?: string;
  externalId?: string;
  transactionId?: string;
  status: ReconResultStatus;
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
  operator: ReconMatchOperator,
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
  externalRecord: ReconRecord,
  transaction: TransactionEntity,
  criterion: ReconMatchCriterion,
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

const matchRule = (
  externalRecord: ReconRecord,
  transaction: TransactionEntity,
  rule: ReconRule,
): boolean =>
  rule.criteria.every((criterion) => matchCriterion(externalRecord, transaction, criterion));

const candidateMismatchReasons = (
  externalRecord: ReconRecord,
  transaction: TransactionEntity,
  rules: ReconRule[],
): string[] => {
  const reasonSets = rules.map((rule) =>
    rule.criteria
      .filter((criterion) => !matchCriterion(externalRecord, transaction, criterion))
      .map((criterion) => `${criterion.field}_mismatch`),
  );
  const shortestReasonCount = Math.min(...reasonSets.map((reasons) => reasons.length));

  return [
    ...new Set(
      reasonSets
        .filter((reasons) => reasons.length === shortestReasonCount)
        .flat()
        .sort(),
    ),
  ];
};

const findReferenceCandidates = (
  externalRecord: ReconRecord,
  transactions: TransactionEntity[],
  rules: ReconRule[],
): ReconMatchCandidate[] =>
  transactions
    .filter((transaction) => matchString(externalRecord.reference, transaction.reference, 'equals'))
    .map((transaction) => ({
      transactionId: transaction.id.value,
      reasons: candidateMismatchReasons(externalRecord, transaction, rules),
    }));

export const reconcileOneToOne = (input: {
  externalRecords: ReconRecord[];
  transactions: TransactionEntity[];
  rules: ReconRule[];
}): ReconMatchDecision[] => {
  const decisionsByExternalRecordId = new Map<string, ReconMatchDecision>();
  const matchedByTransactionId = new Map<string, ReconMatchDecision[]>();

  for (const externalRecord of [...input.externalRecords].sort((left, right) => {
    const dateDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
    return dateDelta === 0 ? left.externalId.localeCompare(right.externalId) : dateDelta;
  })) {
    const candidates = input.transactions
      .filter((transaction) =>
        input.rules.some((rule) => matchRule(externalRecord, transaction, rule)),
      )
      .sort((left, right) => left.id.value.localeCompare(right.id.value));

    if (candidates.length === 1) {
      const decision: ReconMatchDecision = {
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
      input.rules,
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

  const matchedTransactionIds = new Set<string>();
  for (const decision of decisionsByExternalRecordId.values()) {
    if (decision.status === 'matched' && decision.transactionId) {
      matchedTransactionIds.add(decision.transactionId);
    }
  }

  const externalDecisions = [...decisionsByExternalRecordId.values()];
  const unmatchedInternalDecisions = input.transactions
    .filter((transaction) => !matchedTransactionIds.has(transaction.id.value))
    .sort((left, right) => left.id.value.localeCompare(right.id.value))
    .map(
      (transaction): ReconMatchDecision => ({
        transactionId: transaction.id.value,
        status: 'unmatched_internal',
        reason: 'no_external_candidate',
        candidateTransactionIds: [],
      }),
    );

  return [...externalDecisions, ...unmatchedInternalDecisions];
};
