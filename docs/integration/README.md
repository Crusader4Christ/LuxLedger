# Integration Guide

## Choose an integration boundary

- Use `@luxledger/fastify-routes` or `@luxledger/express-routes` when embedding the complete HTTP surface in an existing host.
- Use `@luxledger/core/application` with `@luxledger/postgres-adapter` when composing services without the supplied routes.
- Use `@luxledger/core` alone when implementing custom ports while preserving domain invariants.

## Host responsibilities

1. Provision PostgreSQL 16 and apply the migrations shipped by the adapter.
2. Create a database client and application services from `@luxledger/postgres-adapter`.
3. Authenticate requests before route registration and populate tenant/API-key context.
4. Register exactly one framework adapter.
5. Expose liveness and dependency-aware readiness endpoints (the reference convention is `GET /health` and `GET /ready`), metrics, and structured JSON logs with at least timestamp, level, message, request ID, and tenant-safe context. Handle `SIGTERM`, stop accepting new work, drain in-flight requests, close database connections, and enforce a bounded timeout chosen for the deployment platform.
6. Keep all state-changing orchestration inside explicit transaction boundaries.

## Configuration ownership

`@luxledger/postgres-adapter` reads `DATABASE_URL`, `DB_POOL_MAX`, `DB_IDLE_TIMEOUT`, and `DB_CONNECT_TIMEOUT`. A host may instead pass the corresponding database-client options directly. The core and HTTP contract packages do not read process configuration.

Authentication, rate limiting, bootstrap, server `PORT`, and `SHUTDOWN_TIMEOUT_MS` belong to the host application. The reference profile uses `JWT_ACCESS_TTL_SECONDS=900`; accepted configurable values are 300 through 900 seconds. Node.js does not load `.env` automatically: the host must use its runtime's env-file option or load a dotenv-compatible file before reading configuration.

## Contract conventions

- Send money as integer `amount_minor` values plus an ISO-style currency code.
- Generate a unique stable transaction `reference`; retry the identical payload after timeouts.
- Treat a reference/payload mismatch as a client correctness error, not as a retryable conflict.
- Entry order is ignored during retry comparison, but every entry and duplicate occurrence must match by account, direction, amount, and currency.
- Preserve `effective_at` separately from record creation time.
- Follow cursor pagination fields from the OpenAPI schemas rather than constructing cursors.
- Persist returned resource identifiers; do not derive IDs from names or references.

## Recommended first scenario

Create a ledger, create two same-currency accounts, post one balanced transaction, retry it with the same reference, list its entries, and verify the trial balance. The reference demo provides the runnable commands; the request and response schemas remain canonical in [`openapi.yaml`](../../packages/http/openapi/openapi.yaml).

Before production use, review [invariants](../product/invariants.md), [limitations](../product/limitations.md), [operations runbooks](../runbooks/operations-auth-mvp.md), and [versioning](./versioning.md).

## Troubleshooting

### Reference already exists with a different payload

Do not generate a new payload for an existing transaction reference. Retrieve or reconcile the original request, then retry only if ledger, currency, description, effective time, and entries are identical. A payload mismatch is an intentional [idempotency failure](../product/invariants.md#idempotency), not a transient database error.

### Currency or ledger mismatch

Verify that every account belongs to the target ledger and that each account and entry uses the transaction currency. LuxLedger rejects cross-ledger and mixed-currency postings before committing any effects; see the [posting invariants](../product/invariants.md#posting).

### Missing tenant context

Register authentication middleware before the route adapter and populate `tenantId`, `apiKeyId`, and `apiKeyRole` for every protected request. Never infer a tenant from a resource ID. Tenant-scoped repositories intentionally return not-found or authorization failures for cross-tenant access.

### Migration failure

Stop the rollout and keep application code at the version compatible with the current schema. Inspect the failed Drizzle migration, database permissions, and PostgreSQL version; restore from the deployment backup when required. Do not assume that downgrading a package rolls back the database. Follow the [upgrade procedure](./versioning.md#upgrade-procedure) and the [backup/restore runbook](../runbooks/backup-restore-drill-mvp.md).
