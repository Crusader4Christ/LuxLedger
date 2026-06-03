import { describe, expect, it } from 'bun:test';
import {
  AccountId,
  EntryDirection,
  EntryEntity,
  LedgerId,
  Money,
  TransactionEntity,
  TransactionId,
} from '@lux/ledger';
import {
  type ExternalReconciliationRecord,
  type ReconciliationMatchingRule,
  reconcileOneToOne,
} from './index';

const rule = (criteria: ReconciliationMatchingRule['criteria']): ReconciliationMatchingRule => ({
  id: 'rule-1',
  tenantId: 'tenant-1',
  name: 'Baseline',
  description: null,
  criteria,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const transaction = (input: {
  id: string;
  reference: string;
  amountMinor: bigint;
  currency?: string;
  createdAt?: Date;
}): TransactionEntity =>
  new TransactionEntity({
    id: new TransactionId(input.id),
    tenantId: 'tenant-1',
    ledgerId: new LedgerId('ledger-1'),
    reference: input.reference,
    currency: input.currency ?? 'USD',
    createdAt: input.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    entries: [
      new EntryEntity({
        accountId: new AccountId('account-1'),
        direction: EntryDirection.DEBIT,
        money: Money.of(input.amountMinor, input.currency ?? 'USD'),
      }),
      new EntryEntity({
        accountId: new AccountId('account-2'),
        direction: EntryDirection.CREDIT,
        money: Money.of(input.amountMinor, input.currency ?? 'USD'),
      }),
    ],
  });

const externalRecord = (input: {
  externalId: string;
  reference: string;
  amountMinor: bigint;
  currency?: string;
  occurredAt?: Date;
}): ExternalReconciliationRecord => ({
  id: `external-record-${input.externalId}`,
  tenantId: 'tenant-1',
  uploadId: 'upload-1',
  externalId: input.externalId,
  source: 'Stripe',
  amountMinor: input.amountMinor,
  currency: input.currency ?? 'USD',
  reference: input.reference,
  description: null,
  occurredAt: input.occurredAt ?? new Date('2026-01-01T00:00:00.000Z'),
  raw: null,
});

const exactRule = rule([
  { field: 'reference', operator: 'equals' },
  { field: 'amount', operator: 'equals' },
  { field: 'currency', operator: 'equals' },
  { field: 'date', operator: 'equals' },
]);

describe('reconcileOneToOne', () => {
  it('matches one external record to one internal transaction exactly', () => {
    const decisions = reconcileOneToOne({
      externalRecords: [
        externalRecord({ externalId: 'ext-1', reference: 'ref-1', amountMinor: 100n }),
      ],
      transactions: [transaction({ id: 'tx-1', reference: 'ref-1', amountMinor: 100n })],
      rules: [exactRule],
    });

    expect(decisions.filter((decision) => decision.status === 'matched')).toHaveLength(1);
    expect(decisions.find((decision) => decision.status === 'matched')?.transactionId).toBe('tx-1');
  });

  it('uses explicit amount and date tolerances', () => {
    const decisions = reconcileOneToOne({
      externalRecords: [
        externalRecord({
          externalId: 'ext-1',
          reference: 'ref-1',
          amountMinor: 101n,
          occurredAt: new Date('2026-01-01T00:00:30.000Z'),
        }),
      ],
      transactions: [
        transaction({
          id: 'tx-1',
          reference: 'ref-1',
          amountMinor: 100n,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      rules: [
        rule([
          { field: 'reference', operator: 'equals' },
          { field: 'amount', operator: 'equals', amountToleranceMinor: 1n },
          { field: 'date', operator: 'equals', dateToleranceSeconds: 30 },
          { field: 'currency', operator: 'equals' },
        ]),
      ],
    });

    expect(decisions.filter((decision) => decision.status === 'matched')).toHaveLength(1);
  });

  it('reports mismatches when reference matches but criteria fail', () => {
    const decisions = reconcileOneToOne({
      externalRecords: [
        externalRecord({ externalId: 'ext-1', reference: 'ref-1', amountMinor: 105n }),
      ],
      transactions: [transaction({ id: 'tx-1', reference: 'ref-1', amountMinor: 100n })],
      rules: [
        rule([
          { field: 'reference', operator: 'equals' },
          { field: 'amount', operator: 'equals' },
          { field: 'currency', operator: 'equals' },
        ]),
      ],
    });

    const mismatch = decisions.find((decision) => decision.status === 'mismatched');
    expect(mismatch?.reason).toBe('amount_mismatch');
    expect(mismatch?.candidateTransactionIds).toEqual(['tx-1']);
    expect(decisions.some((decision) => decision.status === 'unmatched_internal')).toBeFalse();
  });

  it('does not choose arbitrarily when multiple internal candidates match', () => {
    const decisions = reconcileOneToOne({
      externalRecords: [
        externalRecord({ externalId: 'ext-1', reference: 'ref-1', amountMinor: 100n }),
      ],
      transactions: [
        transaction({ id: 'tx-1', reference: 'ref-1', amountMinor: 100n }),
        transaction({ id: 'tx-2', reference: 'ref-1', amountMinor: 100n }),
      ],
      rules: [exactRule],
    });

    const conflict = decisions.find((decision) => decision.status === 'conflict');
    expect(conflict?.reason).toBe('multiple_internal_candidates');
    expect(conflict?.candidateTransactionIds).toEqual(['tx-1', 'tx-2']);
    expect(decisions.some((decision) => decision.status === 'unmatched_internal')).toBeFalse();
  });
});
