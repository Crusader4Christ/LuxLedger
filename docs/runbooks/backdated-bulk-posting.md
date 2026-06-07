# Backdated and Bulk Posting

## Effective date

Transactions have two timestamps:

- `created_at`: when LuxLedger persisted the transaction.
- `effective_at`: when the transaction affects accounting history.

When `effective_at` is omitted, the repository stores the current timestamp. Backdated postings set `effective_at` to the accounting event time.

Balance snapshots are materialized account states. For a backdated transaction, LuxLedger inserts the new snapshot at the transaction `effective_at` and applies the same posted-balance delta to later snapshots for each affected account. This keeps `balance-as-of` and balance history reads deterministic without reconstructing from every transaction.

## Bulk policy

`POST /v1/transactions/bulk` is all-or-nothing. The service validates the request and the repository posts every item in one database transaction. If any item fails validation, account lookup, ledger/currency checks, double-entry checks, overdraft policy, or database constraints, the whole batch rolls back.

Duplicate references inside one bulk request are rejected before the repository write. Existing `(tenant_id, reference)` rows remain idempotent retries when the payload matches the persisted transaction.

## Failure modes

- Request schema errors return `400` before service execution.
- Duplicate references in the same batch fail the whole batch.
- Domain invariant failures fail the whole batch.
- Database constraint failures are mapped to repository/application errors; raw database errors are not exposed.
- No partial success response is returned for failed batches.

Item-level bulk failures use `BULK_TRANSACTION_FAILED` and include `details.item_index`,
`details.reference`, and a `VALIDATION`, `CONFLICT`, or `PERSISTENCE` category.

## Throughput expectations

Bulk posting uses one SQL transaction and updates account rows in account-id order to keep lock acquisition deterministic. The HTTP contract caps a batch at 100 transactions. Larger imports should split work into multiple requests and retry failed requests by reference.
