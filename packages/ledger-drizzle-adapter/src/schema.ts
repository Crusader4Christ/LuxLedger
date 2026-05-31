import { AccountSide, EntryDirection } from '@lux/ledger';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
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
    currency: text('currency').notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    inflightDebitMinor: bigint('inflight_debit_minor', { mode: 'bigint' }).notNull().default(sql`0`),
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
export const balanceSnapshotEventTypeEnum = pgEnum('balance_snapshot_event_type', [
  'TX_APPLIED',
  'HOLD_CREATED',
  'HOLD_COMMITTED',
  'HOLD_VOIDED',
  'ADJUSTMENT',
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
    holdsTenantReferenceUq: uniqueIndex('holds_tenant_reference_uq').on(table.tenantId, table.reference),
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
    holdId: uuid('hold_id').references(() => holds.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
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
