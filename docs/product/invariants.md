# Ledger Guarantees and Invariants

These rules define the behavior integrators may rely on. The OpenAPI contract defines transport shapes; core and persistence tests define executable behavior. Posting balance is covered by the [transaction entity tests](../../packages/core/src/transaction/entity.test.ts) and [posting integration tests](../../packages/postgres-adapter/test/integration/transaction-posting.integration.test.ts). Tenant isolation is exercised by the [account](../../packages/postgres-adapter/test/integration/account-repository.integration.test.ts) and [transaction query](../../packages/postgres-adapter/test/integration/transaction-query.integration.test.ts) integration suites.

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
- Credit-grant refunds remove only current unspent, unreserved, unexpired capacity and append immutable `REFUND` lineage in the same transaction as their balanced posting.
- Posted and in-flight balances are derived within the same transaction as their source event.
- Core tables are not soft-deleted.

## Idempotency

Idempotency is layered rather than owned by a single component. Application services validate commands before persistence. The PostgreSQL adapter executes the write transaction, compares an existing payload with the retry, and returns the existing result only for an identical request. The database unique index on `(tenant_id, reference)` provides the final concurrency boundary. Reusing a reference with a different payload fails instead of silently changing state. Bulk, reversal, correction, and hold operations preserve their documented idempotent and atomic behavior.

Credit-grant refund references are tenant-scoped idempotency keys. An identical grant and amount retry returns the original refund transaction; changing the grant or amount conflicts.

Transaction payload identity includes ledger, currency, normalized nullable description, explicit effective time, relation metadata, and the complete entry multiset (account, signed amount, and currency). Entry order is not significant; entry multiplicity is significant. Omitting `effective_at` means the server assigns accounting time on first creation, so a retry must also omit it unless the original explicit value is known.

The behavior is covered by the [posting](../../packages/postgres-adapter/test/integration/transaction-posting.integration.test.ts), [reversal](../../packages/postgres-adapter/test/integration/transaction-reversal.integration.test.ts), and [correction](../../packages/postgres-adapter/test/integration/transaction-correction.integration.test.ts) integration suites.

## Operational adjustments

Operational credit and debit adjustments are balanced postings with an explicit target account and offset account. Every command requires a tenant-wide reference, positive int64 minor-unit amount, description, host-defined reason code, and opaque actor ID, and may include opaque attributes. The reason catalog and authorization policy remain host responsibilities.

Each accepted adjustment is an immutable, auditable ledger event created atomically with its posting. An exact retry returns the original transaction without posting again, while reusing the reference for a different command conflicts. Account `overdraft_policy` remains the negative-capacity authority, so a rejected adjustment leaves ledger state unchanged.

A debit adjustment against a grant-enabled target account consumes existing eligible grant capacity. Crediting a grant-enabled account through an adjustment is rejected; hosts that need new spendable grant capacity must issue a grant instead.

## Bounded statements

Account statements use the same historical snapshot boundary as `balance-as-of`. The opening balance
includes events effective at `from`; statement movements cover `(from, as_of]`, and the closing
balance includes events effective at `as_of`. For each of posted, reserved, and available minor
units, opening plus all movement deltas equals closing. Movement pages are ordered by
`(effective_at, id)` ascending and the opaque cursor encodes that complete tie-break tuple. It is
bound to tenant, account, `from`, and `as_of`. Reconciliation applies after aggregating movement
deltas from every page; each page repeats the same range-level opening and closing values.

Credit statements expose a flat, bounded stream of immutable grant-capacity versions rather than
nesting an unbounded lot array. They include issuance, consumption, compensation, reversal, refund,
expiration, and hold reservation/release provenance. Their opening and closing available totals use
the same explicit `from` and `as_of` operational boundaries. Unlike account statements, their time
basis is capacity-version `created_at`: credit capacity has operational provenance but no independent
accounting-effective clock. Credit movements therefore expose equal `effective_at` and `created_at`
values, are ordered by `(created_at, id)` ascending, and use a cursor additionally bound to an
optional grant filter. Product labels and redaction policy are host responsibilities.

The fixed `as_of` boundary excludes events written later with a later statement time. It is not a
database transaction snapshot shared across HTTP requests: if a posting is inserted later with an
`effective_at` inside an account statement's existing range, clients that require a frozen export
must restart pagination. This distinction matters because account snapshots deliberately propagate
backdated postings through later materialized balances.

## Authentication contract

The reference HTTP composition exchanges an API key for an access token with an exact default TTL of 900 seconds. Revoking the backing API key invalidates its access tokens on the next authenticated request. Hosts remain responsible for key storage, TLS, secret rotation, and perimeter controls.
