# Ledger Guarantees and Invariants

These rules define the behavior integrators may rely on. The OpenAPI contract defines transport shapes; core and persistence tests define executable behavior.

## Posting

- Every transaction has at least two entries and total debits equal total credits.
- Transaction entries use the transaction currency and accounts from the same ledger.
- Account currency must match the posting currency.
- Monetary values use integer minor units; floating-point amounts are not accepted.
- A posting is immutable. Reversal creates an opposite transaction; correction atomically creates a reversal and replacement.
- Backdated `effective_at` changes accounting time without rewriting creation history.

## Isolation and consistency

- Every core record belongs to a tenant; repository operations scope reads and writes by tenant.
- State-changing operations run inside explicit PostgreSQL transactions.
- Bulk posting is all-or-nothing. Correction and hold transitions are atomic.
- Posted and in-flight balances are derived within the same transaction as their source event.
- Core tables are not soft-deleted.

## Idempotency

Transaction references are unique by `(tenant_id, reference)`. Repeating the same reference and payload returns the existing result. Reusing a reference with a different payload fails instead of silently changing state. Bulk, reversal, correction, and hold operations preserve their documented idempotent and atomic behavior.

## Authentication contract

The reference HTTP composition exchanges an API key for an access token with an exact default TTL of 900 seconds. Revoking the backing API key invalidates its access tokens on the next authenticated request. Hosts remain responsible for key storage, TLS, secret rotation, and perimeter controls.
