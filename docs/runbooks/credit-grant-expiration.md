# Credit grant expiration operations

## Semantics

Expiration is immutable accounting, not a grant status change. A lot is spend-eligible only while `expires_at` is null or strictly greater than both the transaction `effective_at` and PostgreSQL `transaction_timestamp()`. At equality it is expired. Allocation and due scanning use `expires_at ASC NULLS LAST, created_at ASC, id ASC`.

`POST /v1/credit-grants/expiration/preview` is read-only and may use a future `as_of` for capacity planning. `POST /v1/credit-grants/expiration/run` requires `as_of` no later than database time. Both require a limit from 1 through 100. Repeat run calls until `items` is empty; each response is one bounded page, not a cursor snapshot.

## Worker behavior

Run claims due grants with `FOR UPDATE SKIP LOCKED`. Multiple workers may therefore receive different-sized pages, including an empty page while another worker owns the earliest rows. After claiming, run re-aggregates immutable lineage in a separate statement while the grant locks remain held; concurrent capacity changes cannot leave the posting amount stale. Each claimed positive balance posts a debit to the grant account and credit to the original funding account. The ledger transaction, entries, `EXPIRATION` lineage, balances, and snapshots share one database transaction.

The reference format is `credit-grant-expiration:<grant-id>:<cumulative-expired-minor>`. A retry of the same state resolves to the existing posting. A later compensation can restore capacity after an earlier expiration; the higher cumulative amount creates a new deterministic reference and is re-expired inside the reversal or correction transaction before commit.

## Observability

Record one structured event per API call with operation (`preview` or `run`), tenant ID, requested `as_of`, requested limit, returned item count, total `amount_minor`, duration, and outcome. For run, also record the returned grant and transaction IDs. Do not log external references or credentials.

Alert on repeated run failures, non-empty previews older than the worker service-level objective, sustained full pages (backlog), or a high ratio of empty concurrent-worker pages combined with stale due previews (lock contention). Database constraint failures are correctness alerts, not retry noise. Track late-compensation expiration counts separately because they indicate reversals arriving after customer-visible expiry.

## Recovery and query cost

Retry failed runs with the same `as_of`; successful grants are already absent from derived remaining capacity. Never repair by updating grant rows or lineage. Investigate with the grant response, credit-balance read, allocation lineage, transaction entries, and balance snapshots.

The due index bounds tenant/date ordering, but capacity remains an aggregate over immutable lineage. Preview and run therefore pay lineage aggregation cost for the tenant's grants before applying the bounded result limit. Run also performs a second bounded aggregate for only the claimed grant IDs so posting uses capacity observed after locking. Credit-balance reads similarly aggregate all committed lineage for the account. Monitor those scans as history grows; do not add a mutable balance cache as an authority.
