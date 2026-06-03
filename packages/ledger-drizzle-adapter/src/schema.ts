import { AccountSide, EntryDirection } from '@lux/ledger';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().default(sql`uuid_v7()`),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountSideEnum = pgEnum(
  'account_side',
  Object.values(AccountSide) as [string, ...string[]],
);
export const overdraftPolicyEnum = pgEnum('overdraft_policy', ['ALLOW', 'DISALLOW']);
export const entryDirectionEnum = pgEnum(
  'entry_direction',
  Object.values(EntryDirection) as [string, ...string[]],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull(),
    keyHash: text('key_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    apiKeysTenantIdIdx: index('api_keys_tenant_id_idx').on(table.tenantId),
    apiKeysKeyHashUq: uniqueIndex('api_keys_key_hash_uq').on(table.keyHash),
    apiKeysRoleChk: check('api_keys_role_chk', sql`${table.role} in ('ADMIN', 'SERVICE')`),
  }),
);

export const ledgers = pgTable(
  'ledgers',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ledgersTenantIdIdx: index('ledgers_tenant_id_idx').on(table.tenantId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => ledgers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    side: accountSideEnum('side').notNull(),
    overdraftPolicy: overdraftPolicyEnum('overdraft_policy').notNull().default('ALLOW'),
    currency: text('currency').notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    inflightDebitMinor: bigint('inflight_debit_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    inflightCreditMinor: bigint('inflight_credit_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountsTenantIdIdx: index('accounts_tenant_id_idx').on(table.tenantId),
    accountsLedgerIdIdx: index('accounts_ledger_id_idx').on(table.ledgerId),
  }),
);

export const holdStateEnum = pgEnum('hold_state', ['HELD', 'APPLIED', 'VOIDED']);
export const transactionRelationTypeEnum = pgEnum('transaction_relation_type', [
  'REVERSAL',
  'CORRECTION',
]);
export const balanceSnapshotEventTypeEnum = pgEnum('balance_snapshot_event_type', [
  'TX_APPLIED',
  'HOLD_CREATED',
  'HOLD_COMMITTED',
  'HOLD_VOIDED',
  'ADJUSTMENT',
]);

export const reconRunStatusEnum = pgEnum('reconciliation_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);
export const reconResultStatusEnum = pgEnum('reconciliation_result_status', [
  'matched',
  'unmatched_external',
  'unmatched_internal',
  'mismatched',
  'conflict',
]);

export const holds = pgTable(
  'holds',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => ledgers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    reference: text('reference').notNull(),
    currency: text('currency').notNull(),
    description: text('description'),
    state: holdStateEnum('state').notNull().default('HELD'),
    originalAmountMinor: bigint('original_amount_minor', { mode: 'bigint' }).notNull(),
    remainingAmountMinor: bigint('remaining_amount_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
  },
  (table) => ({
    holdsTenantReferenceUq: uniqueIndex('holds_tenant_reference_uq').on(
      table.tenantId,
      table.reference,
    ),
    holdsLedgerIdIdx: index('holds_ledger_id_idx').on(table.ledgerId),
  }),
);

export const holdEntries = pgTable(
  'hold_entries',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    holdId: uuid('hold_id')
      .notNull()
      .references(() => holds.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    direction: entryDirectionEnum('direction').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    holdEntriesTenantIdIdx: index('hold_entries_tenant_id_idx').on(table.tenantId),
    holdEntriesHoldIdIdx: index('hold_entries_hold_id_idx').on(table.holdId),
    holdEntriesAccountIdIdx: index('hold_entries_account_id_idx').on(table.accountId),
  }),
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => ledgers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    holdId: uuid('hold_id').references(() => holds.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    relatedTransactionId: uuid('related_transaction_id').references(
      (): AnyPgColumn => transactions.id,
      {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      },
    ),
    relationType: transactionRelationTypeEnum('relation_type'),
    reference: text('reference').notNull(),
    currency: text('currency').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    transactionsTenantReferenceUq: uniqueIndex('transactions_tenant_reference_uq').on(
      table.tenantId,
      table.reference,
    ),
    transactionsLedgerIdIdx: index('transactions_ledger_id_idx').on(table.ledgerId),
    transactionsHoldIdIdx: index('transactions_hold_id_idx').on(table.holdId),
    transactionsRelatedIdIdx: index('transactions_related_transaction_id_idx').on(
      table.relatedTransactionId,
    ),
    transactionsRelationUq: uniqueIndex('transactions_relation_uq')
      .on(table.tenantId, table.relationType, table.relatedTransactionId)
      .where(sql`${table.relatedTransactionId} is not null`),
    transactionsRelationPairCk: check(
      'transactions_relation_pair_ck',
      sql`(${table.relatedTransactionId} is null and ${table.relationType} is null) or (${table.relatedTransactionId} is not null and ${table.relationType} is not null)`,
    ),
  }),
);

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    direction: entryDirectionEnum('direction').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entriesTenantIdIdx: index('entries_tenant_id_idx').on(table.tenantId),
    entriesTransactionIdIdx: index('entries_transaction_id_idx').on(table.transactionId),
    entriesAccountIdIdx: index('entries_account_id_idx').on(table.accountId),
  }),
);

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => ledgers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    eventType: balanceSnapshotEventTypeEnum('event_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    postedMinor: bigint('posted_minor', { mode: 'bigint' }).notNull(),
    inflightDebitMinor: bigint('inflight_debit_minor', { mode: 'bigint' }).notNull(),
    inflightCreditMinor: bigint('inflight_credit_minor', { mode: 'bigint' }).notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    balanceSnapshotsAsOfIdx: index('balance_snapshots_as_of_idx').on(
      table.tenantId,
      table.accountId,
      table.effectiveAt,
    ),
    balanceSnapshotsSourceIdx: index('balance_snapshots_source_idx').on(
      table.tenantId,
      table.sourceId,
      table.eventType,
    ),
    balanceSnapshotsDedupUq: uniqueIndex('balance_snapshots_dedup_uq').on(
      table.tenantId,
      table.eventType,
      table.sourceId,
      table.accountId,
    ),
  }),
);

export const reconUploads = pgTable(
  'recon_uploads',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    source: text('source').notNull(),
    recordCount: bigint('record_count', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reconUploadsTenantIdIdx: index('recon_uploads_tenant_idx').on(table.tenantId),
    reconUploadsSourceIdx: index('recon_uploads_source_idx').on(table.tenantId, table.source),
  }),
);

export const reconRecords = pgTable(
  'recon_records',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => reconUploads.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    externalId: text('external_id').notNull(),
    source: text('source').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    reference: text('reference').notNull(),
    description: text('description'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    raw: jsonb('raw').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reconRecordsUploadIdx: index('recon_records_upload_idx').on(table.tenantId, table.uploadId),
    reconRecordsSourceExternalUq: uniqueIndex('recon_records_source_external_uq').on(
      table.tenantId,
      table.source,
      table.externalId,
    ),
  }),
);

export const reconRules = pgTable(
  'recon_rules',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    criteria: jsonb('criteria')
      .$type<
        Array<{
          field: string;
          operator: string;
          amountToleranceMinor?: string;
          dateToleranceSeconds?: number;
        }>
      >()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reconRulesTenantIdx: index('recon_rules_tenant_idx').on(table.tenantId),
    reconRulesTenantNameUq: uniqueIndex('recon_rules_tenant_name_uq').on(
      table.tenantId,
      table.name,
    ),
  }),
);

export const reconRuns = pgTable(
  'recon_runs',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => ledgers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => reconUploads.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    strategy: text('strategy').notNull(),
    status: reconRunStatusEnum('status').notNull().default('pending'),
    dryRun: boolean('dry_run').notNull().default(false),
    matchedCount: bigint('matched_count', { mode: 'number' }).notNull().default(0),
    unmatchedExternalCount: bigint('unmatched_external_count', { mode: 'number' })
      .notNull()
      .default(0),
    unmatchedInternalCount: bigint('unmatched_internal_count', { mode: 'number' })
      .notNull()
      .default(0),
    mismatchedCount: bigint('mismatched_count', { mode: 'number' }).notNull().default(0),
    conflictCount: bigint('conflict_count', { mode: 'number' }).notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    reconRunsTenantIdx: index('recon_runs_tenant_idx').on(table.tenantId),
    reconRunsUploadIdx: index('recon_runs_upload_idx').on(table.uploadId),
    reconRunsStrategyCk: check('recon_runs_strategy_ck', sql`${table.strategy} = 'one_to_one'`),
  }),
);

export const reconResults = pgTable(
  'recon_results',
  {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconRuns.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    externalRecordId: uuid('external_record_id').references(() => reconRecords.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    externalId: text('external_id'),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    status: reconResultStatusEnum('status').notNull(),
    reason: text('reason').notNull(),
    candidateTransactionIds: jsonb('candidate_transaction_ids').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reconResultsRunIdx: index('recon_results_run_idx').on(table.runId),
    reconResultsTenantStatusIdx: index('recon_results_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);
