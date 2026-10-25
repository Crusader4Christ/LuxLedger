import type { FilterFields } from './list-filter';

const id = { kind: 'uuid' } as const;
const text = { kind: 'string' } as const;
const nullableText = { kind: 'string', nullable: true } as const;
const time = { kind: 'date-time', ordered: true } as const;
const minor = { kind: 'integer-string', ordered: true } as const;

export const accountFilterFields = {
  id,
  ledger_id: { ...id, target: 'ledgerId' },
  code: nullableText,
  name: text,
  side: { kind: 'enum', values: ['DEBIT', 'CREDIT'] },
  overdraft_policy: { kind: 'enum', values: ['ALLOW', 'DISALLOW'], target: 'overdraftPolicy' },
  grant_enabled: { kind: 'boolean', target: 'grantEnabled' },
  currency: text,
  balance_minor: { ...minor, target: 'balanceMinor' },
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
export const transactionFilterFields = {
  id,
  ledger_id: { ...id, target: 'ledgerId' },
  reference: text,
  currency: text,
  description: nullableText,
  related_transaction_id: { ...id, nullable: true, target: 'relatedTransactionId' },
  relation_type: {
    kind: 'enum',
    nullable: true,
    values: ['REVERSAL', 'CORRECTION'],
    target: 'relationType',
  },
  created_at: { ...time, target: 'createdAt' },
  effective_at: { ...time, target: 'effectiveAt' },
} satisfies FilterFields;
export const entryFilterFields = {
  id,
  transaction_id: { ...id, target: 'transactionId' },
  account_id: { ...id, target: 'accountId' },
  signed_amount_minor: { ...minor, target: 'signedAmountMinor' },
  currency: text,
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
export const ledgerFilterFields = {
  id,
  name: text,
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
export const apiKeyFilterFields = {
  id,
  name: text,
  role: { kind: 'enum', values: ['ADMIN', 'SERVICE'] },
  created_at: { ...time, target: 'createdAt' },
  revoked_at: { ...time, nullable: true, target: 'revokedAt' },
} satisfies FilterFields;
export const creditGrantFilterFields = {
  id,
  ledger_id: { ...id, target: 'ledgerId' },
  account_id: { ...id, target: 'accountId' },
  funding_account_id: { ...id, target: 'fundingAccountId' },
  reference: text,
  external_reference: { ...nullableText, target: 'externalReference' },
  transaction_id: { ...id, target: 'transactionId' },
  created_at: { ...time, target: 'createdAt' },
  expires_at: { ...time, nullable: true, target: 'expiresAt' },
} satisfies FilterFields;
export const creditLineageFilterFields = {
  grant_id: { ...id, target: 'grantId' },
  entry_id: { ...id, target: 'entryId' },
  transaction_id: { ...id, target: 'transactionId' },
  kind: { kind: 'enum', values: ['CONSUMPTION', 'COMPENSATION', 'EXPIRATION', 'REFUND'] },
  amount_minor: { ...minor, target: 'amountMinor' },
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
export const balanceHistoryFilterFields = {
  id,
  ledger_id: { ...id, target: 'ledgerId' },
  account_id: { ...id, target: 'accountId' },
  event_type: {
    kind: 'enum',
    values: ['TX_APPLIED', 'HOLD_CREATED', 'HOLD_COMMITTED', 'HOLD_VOIDED', 'ADJUSTMENT'],
    target: 'eventType',
  },
  source_id: { ...id, target: 'sourceId' },
  posted_minor: { ...minor, target: 'postedMinor' },
  reserved_delta_minor: { ...minor, target: 'reservedDeltaMinor' },
  effective_at: { ...time, target: 'effectiveAt' },
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
export const reconRuleFilterFields = {
  id,
  name: text,
  description: nullableText,
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
export const reconResultListFilterFields = {
  id,
  run_id: { ...id, target: 'runId' },
  external_record_id: { ...id, nullable: true, target: 'externalRecordId' },
  external_id: { ...nullableText, target: 'externalId' },
  transaction_id: { ...id, nullable: true, target: 'transactionId' },
  status: {
    kind: 'enum',
    values: ['matched', 'unmatched_external', 'unmatched_internal', 'mismatched', 'conflict'],
  },
  reason: text,
  created_at: { ...time, target: 'createdAt' },
} satisfies FilterFields;
