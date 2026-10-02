# Credit grant expiration operations

## Semantics

Expiration is immutable accounting, not a grant status change. A lot is spend-eligible only while `expires_at` is null or strictly greater than both the transaction `effective_at` and PostgreSQL `transaction_timestamp()`. At equality it is expired. Allocation and due scanning use `expires_at ASC NULLS LAST, created_at ASC, id ASC`.

`POST /v1/credit-grants/expiration/preview` is read-only and may use a future `as_of` for capacity planning. `POST /v1/credit-grants/expiration/run` requires `as_of` no later than database time. Both require a limit from 1 through 100. Repeat run calls until `items` is empty; each response is one bounded page, not a cursor snapshot.

## Worker behavior

Run claims due grants with `FOR UPDATE SKIP LOCKED`. Multiple workers may therefore receive different-sized pages, including an empty page while another worker owns the earliest rows. After claiming, run reads the latest immutable capacity version in a separate statement while the grant locks remain held; concurrent capacity changes cannot leave the posting amount stale. Each claimed positive balance posts a debit to the grant account and credit to the original funding account. The ledger transaction, entries, `EXPIRATION` lineage, capacity version, balances, and snapshots share one database transaction.

The reference format is `credit-grant-expiration:<grant-id>:<cumulative-expired-minor>`. A retry of the same state resolves to the existing posting. A later compensation can restore capacity after an earlier expiration; the higher cumulative amount creates a new deterministic reference and is re-expired inside the reversal or correction transaction before commit.

## Observability

Record one structured event per API call with operation (`preview` or `run`), tenant ID, requested `as_of`, requested limit, returned item count, total `amount_minor`, duration, and outcome. For run, also record the returned grant and transaction IDs. Do not log external references or credentials.

Alert on repeated run failures, non-empty previews older than the worker service-level objective, sustained full pages (backlog), or a high ratio of empty concurrent-worker pages combined with stale due previews (lock contention). Database constraint failures are correctness alerts, not retry noise. Track late-compensation expiration counts separately because they indicate reversals arriving after customer-visible expiry.

## Recovery and query cost

Retry failed runs with the same `as_of`; successful grants are already absent from derived remaining capacity. Never repair by updating grant rows or lineage. Investigate with the grant response, credit-balance read, allocation lineage, transaction entries, and balance snapshots.

The due index bounds tenant/date ordering. Each lineage append also creates an immutable cumulative capacity version in the same transaction; the latest version is a rebuildable index over ledger entries and lineage, not a mutable financial authority. Preview performs one indexed latest-version lookup per due grant considered and stops at the bounded result limit. Run repeats latest-version lookup only for the claimed grant IDs after locking. Credit-balance reads fetch one latest version per grant plus the authoritative ledger total, so none of these hot paths aggregates the tenant or account's complete lineage history.

Query cost is therefore proportional to due grants considered or account grant count, rather than historical movement count. A large population of already-exhausted expired grants can still increase due-index scanning because the remaining-capacity predicate lives in the lateral latest-version lookup. Monitor examined-versus-returned rows and page latency; add a purpose-built immutable eligibility index only if production evidence warrants it. Never repair an incident by updating or deleting capacity versions: verify the underlying entries and lineage, then rebuild versions from that immutable history.
