# Database schema guide

The executable schema in [`packages/postgres-adapter/src/schema.ts`](../packages/postgres-adapter/src/schema.ts) is authoritative for columns, types, constraints, indexes, and relationships. Drizzle does not currently carry a description for every column into PostgreSQL, so this guide documents intent. Non-obvious monetary columns also have nearby source comments and PostgreSQL `COMMENT ON COLUMN` statements in the migration that introduced them.

## Shared conventions

- `id` is a UUIDv7 primary key unless a table declares a composite key.
- `tenant_id` is the ownership boundary. Composite foreign keys keep ledger objects inside the same tenant and ledger.
- `created_at` is database creation time; `updated_at` is the last projection mutation time where present; `effective_at` is accounting time.
- `currency` is the external asset code copied for API compatibility; `asset_id` is the tenant-scoped relational identity.
- Monetary integers are minor units. Only `entries.signed_amount_minor`, `hold_entries.signed_amount_minor`, posted balances, and reservation deltas are signed accounting values. Capacity and lifecycle counters are non-negative magnitudes.

## Core ownership and authentication

- `tenants`: `id`, display `name`, and `created_at` for each isolation boundary.
- `assets`: tenant asset `code`, decimal `scale`, and creation time. `(tenant_id, code)` is unique.
- `api_keys`: tenant-scoped key `name`, authorization `role`, one-way `key_hash`, issue time, and nullable `revoked_at`.
- `ledgers`: tenant-scoped ledger `name` plus creation and update timestamps.

## Accounts and journal

- `accounts`: belongs to a tenant and ledger; optional stable `code`; display `name`; natural `side` (`DEBIT` or `CREDIT`); `overdraft_policy`; asset identity; signed posted `balance_minor`; signed pending `reserved_delta_minor`; `grant_enabled`; timestamps. `balance_minor` and `reserved_delta_minor` are lock-protected projections, while journal entries remain the accounting authority.
- `transactions`: tenant/ledger transaction header with idempotency `reference`, asset, optional `description`, accounting `effective_at`, and database `created_at`. `hold_id` links a hold commit. `related_transaction_id` plus `relation_type` identifies a reversal or correction relationship.
- `entries`: immutable transaction legs. `signed_amount_minor > 0` is DEBIT and `< 0` is CREDIT; all legs of a transaction sum to zero. `transaction_id`, `account_id`, asset identity, and `created_at` define scope and provenance.
- `holds`: reservation header with idempotency `reference`, asset, description, lifecycle `state`, positive `original_amount_minor`, positive `remaining_amount_minor`, and created/applied/voided timestamps.
- `hold_entries`: immutable signed hold legs with the same sign convention as posted entries. They are the authority used to commit or release a hold.
- `balance_snapshots`: immutable event projection for historical reads. `event_type` and `source_id` identify the mutation; `posted_minor` and `reserved_delta_minor` copy the account projections at `effective_at`; `created_at` records persistence time.

## Credit grants

- `credit_grants`: grant identity and idempotency reference; beneficiary `account_id`; `funding_account_id`; issuance `transaction_id`; optional external reference and expiry; creation time.
- `credit_grant_entries`: allocation of a positive `amount_minor` magnitude from one ledger entry to a grant, classified as issuance, reversal, consumption, compensation, or expiration. `(grant_id, entry_id)` is the primary key.
- `credit_grant_capacity_versions`: append-only capacity projection per grant and version. It stores non-negative granted, reversed, consumed, compensated, expired, and remaining magnitudes; `source_entry_id` identifies the allocation that produced the version.

## Reconciliation

- `recon_uploads`: an imported source batch, its record count, and creation time.
- `recon_records`: normalized external record with source/external identity, amount, currency, reference, optional description, occurrence time, raw JSON, and creation time.
- `recon_rules`: tenant matching rule with name, JSON definition, enabled flag, and creation time.
- `recon_runs`: execution header connecting tenant, ledger, upload, and rule; includes status, start/completion times, summary counters, optional error, and creation time.
- `recon_results`: one run result linking an optional external record and optional internal transaction, classified by match status with optional detail and creation time.

## Why projections exist

`accounts.balance_minor` is the posted balance; there is no separate `posted_minor` on the current account row. `reserved_delta_minor` is the only current reservation aggregate. Both are updated atomically with journal or hold rows and checked against immutable data in tests. They avoid replaying an unbounded journal on every authorization while preserving entries and hold entries as the reconstructable source of truth.
