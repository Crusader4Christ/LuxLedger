# Snapshot Guarantees

## Scope
- Applies to account historical balance reads:
  - `GET /v1/accounts/:id/balance-as-of`
  - `GET /v1/accounts/:id/balance-history`

## Guarantees
- Snapshot writes are part of the same explicit database transaction as the state-changing operation.
- New logical events append deduplicated snapshot rows. Snapshot rows are not strictly immutable: a backdated posting adjusts `posted_minor` on later snapshots so each row remains the materialized account state at its accounting time. Ledger flows do not delete snapshots.
- Snapshot writes happen after account balance fields are updated, so snapshot values represent post-update account state.
- Idempotent retries do not create duplicate snapshots because of unique deduplication keys.
- Snapshot reads are tenant-scoped and deterministic for the same input.
- A backdated posting and all propagation updates commit in the same PostgreSQL transaction.

## Ordering and Pagination
- `balance-history` is ordered by `(effective_at, id)` ascending.
- Events sharing an `effective_at` are resolved deterministically by snapshot `id`.
- Cursor pagination uses the same order and stable cursor encoding/decoding.
- Invalid cursors fail fast with deterministic `Invalid cursor` validation errors.

## Idempotency and Deduplication
- Deduplication key prevents duplicate snapshot insertion for the same logical event and account.
- This is required for retry-safe behavior under transient errors and concurrent client retries.
- Retrying a previously applied event does not reapply propagation because the source operation is resolved at its uniqueness boundary before balances or snapshots are changed.

## Staleness and Performance Notes
- If an account has no recent activity, `balance-as-of` resolves from the latest snapshot at or before `at`.
- This is efficient for typical account activity patterns.
- For very high-volume accounts with very long histories, query latency can increase due to deeper index traversal and larger historical windows.
- Backdated write cost is `O(later snapshots)` for each affected account because later materialized states are updated in the posting transaction.
- Current LL-56 design intentionally avoids a secondary snapshot compaction layer; introduce it only if production latency/SLO data requires it.
