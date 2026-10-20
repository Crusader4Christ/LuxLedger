# Idempotency Reference

This is the single retry contract for LuxLedger state-changing commands. Keys
are always tenant-scoped. A documented identical replay returns the original
resource/result and does not repeat ledger effects; a conflicting replay fails.
Commands marked non-idempotent must not be retried automatically after an
ambiguous timeout without first reconciling state through a read API.

| Command | Idempotency key | Identical replay | Conflict or retry rule |
| --- | --- | --- | --- |
| `POST /v1/auth/token` | None | Issues a new short-lived token | Safe to request again, but this is not persistence idempotency and the token value may differ. |
| `POST /v1/ledgers` | None | Creates another ledger | Non-idempotent; list ledgers and reconcile by ID/name before retrying an ambiguous result. |
| `POST /v1/accounts` | None | May create another account; a repeated non-null code instead meets the ledger/code unique constraint | Non-idempotent; reconcile with the account list before retrying. |
| `POST /v1/transactions` | `(tenant_id, reference)` | `200`, original `transaction_id`, `created: false` | Any payload difference is a conflict. Identity includes ledger, currency, normalized description, metadata, effective time, relation fields, and the complete entry multiset. |
| `POST /v1/transactions/bulk` | Each item's `(tenant_id, reference)` | `200` when all items already exist; original IDs and `created: false` per item | The batch is atomic. Duplicate request references or any conflicting item reject the whole batch. |
| `POST /v1/transactions/{id}/reverse` | `(tenant_id, reference)` plus original transaction ID | `200`, original reversal ID, `created: false` | Reusing the reference for another source or payload conflicts. A source transaction can have only one reversal. |
| `POST /v1/transactions/{id}/correct` | `(tenant_id, reversal_reference)` and `(tenant_id, corrected_reference)` plus original transaction ID | `200`, both original IDs, `created: false` | Both references must resolve to the same atomic correction and payload; partial or mismatched reuse conflicts. |
| `POST /v1/holds` | `(tenant_id, reference)` | `200`, original hold, `created: false` | Ledger, currency, normalized description, and complete entry multiset must match. |
| `POST /v1/holds/{id}/commit` | `(tenant_id, reference)` plus hold ID and amount | `200`, original transaction ID, `created: false` | Reference ownership, hold, and committed amount must match. A new reference creates a new partial commit when capacity remains. |
| `POST /v1/holds/{id}/void` | `(tenant_id, hold_id)` | `200`, `voided: false` after the first successful void | Void has no client key. It conflicts after the hold is fully applied or when its remainder cannot be released exactly. |
| `POST /v1/admin/api-keys` | None | Creates another secret and key record | Never retry automatically: the secret is returned once. List keys, revoke an unintended duplicate, then create a replacement deliberately. |
| `POST /v1/admin/api-keys/{id}/revoke` | `(tenant_id, api_key_id)` state target | A second call currently fails because no active key is updated | Treat a missing/already-revoked result as reconciled only after listing keys; clients must not require a second `204`. |
| `POST /v1/reconciliation/matching-rules` | None | A repeated name meets the tenant/name unique constraint | Non-idempotent; list rules and reconcile before retrying. |
| `POST /v1/reconciliation/external-records` | None at upload level; records are unique by `(tenant_id, source, external_id)` | Does not replay an upload as a stored result | Reconcile the upload after an ambiguous result; reused record keys conflict. |
| `POST /v1/reconciliation/runs` | None | Creates another persisted run; `dry_run: true` creates no persisted run | Non-idempotent when persisted. Retrieve the first run before retrying. |
| `POST /v1/credit-grants` | `(tenant_id, reference)` | `200`, original grant, `created: false` | Ledger, accounts, amount, expiry, and external reference must match; differing ownership or payload conflicts. |
| `POST /v1/credit-grants/expiration/preview` | Read-only preview at `(tenant_id, as_of, limit)` | Recomputes the current bounded preview | Safe to retry, but results may change as grants are consumed or another worker expires them. |
| `POST /v1/credit-grants/expiration/run` | Derived per-grant transaction reference `(tenant_id, grant_id, cumulative_expired_minor)` | Already claimed/expired work is skipped | Concurrent workers use row locks; each committed expiration slice posts once. Reruns may claim newly due work. |
| `POST /v1/credit-grants/{id}/refund` | `(tenant_id, reference)` plus grant ID and amount | `200`, original refund transaction, `created: false` | Changing the amount or grant for a reference conflicts with `CREDIT_GRANT_CONFLICT`. Only unspent, unreserved, unexpired capacity can be refunded. |
| `POST /v1/adjustments/credit`, `POST /v1/adjustments/debit` | `(tenant_id, reference)` plus the full adjustment payload | `200`, original transaction ID, `created: false` | A changed payload conflicts with `ADJUSTMENT_CONFLICT`. The credit leg cannot target a grant-enabled account. |
| `POST /v1/credit-grants/{id}/reversal` | `(tenant_id, reference)` plus grant ID | `200`, original compensated grant, `created: false` | Reference ownership/payload mismatch or a different prior reversal conflicts. Only an unconsumed remainder can be reversed. |

## Core-only commands

`AssetService.create`, tenant/bootstrap creation, and other host composition
commands are not exposed by the reusable HTTP adapters. Asset code uniqueness
and bootstrap database constraints prevent duplicates, but they do not provide
a replay response contract. Hosts must supply their own durable request key when
automatic retry is required.

## Payload comparison details

Entry ordering is ignored while multiplicity is preserved. Metadata uses
PostgreSQL JSON equality: object key order is ignored and array order matters.
Omitting transaction `effective_at` asks the server to assign it on first
creation; retries must omit it again unless the original explicit value is
known. An HTTP `409` represents a recognized state conflict. Some lower-level
invariant conflicts map to `400`; clients must treat both as terminal for the
request key and must not retry with a changed payload.
