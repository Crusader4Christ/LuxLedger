# Snapshot Guarantees

## Scope
- Applies to account historical balance reads:
  - `GET /v1/accounts/:id/balance-as-of`
  - `GET /v1/accounts/:id/balance-history`

## Guarantees
- Snapshot writes are part of the same explicit database transaction as the state-changing operation.
- Snapshot records are append-only; no updates or deletes are performed by ledger flows.
- Snapshot writes happen after account balance fields are updated, so snapshot values represent post-update account state.
- Idempotent retries do not create duplicate snapshots because of unique deduplication keys.
- Snapshot reads are tenant-scoped and deterministic for the same input.

## Ordering and Pagination
- `balance-history` is ordered by `(effective_at, id)` ascending.
- Cursor pagination uses the same order and stable cursor encoding/decoding.
- Invalid cursors fail fast with deterministic `Invalid cursor` validation errors.

## Idempotency and Deduplication
- Deduplication key prevents duplicate snapshot insertion for the same logical event and account.
- This is required for retry-safe behavior under transient errors and concurrent client retries.

## Staleness and Performance Notes
- If an account has no recent activity, `balance-as-of` resolves from the latest snapshot at or before `at`.
- This is efficient for typical account activity patterns.
- For very high-volume accounts with very long histories, query latency can increase due to deeper index traversal and larger historical windows.
- Current LL-56 design intentionally avoids a secondary snapshot compaction layer; introduce it only if production latency/SLO data requires it.
